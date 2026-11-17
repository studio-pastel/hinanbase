// 確定設備値を Supabase から読み、市区町村 JSON に載せて 4 軸を算出し直す（SPEC §5.6 の compute-scores）。
// 元の CSV は使わない。手元に市区町村 JSON がなければ、公開済みのものを配信元から取得する（日次ビルド用）。
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import amenityDefs from '../config/amenity-defs.json' with { type: 'json' }
import { axisKey, compactBreakdown, computeScores, type ScoringDef } from '../shared/score.ts'
import { DISPLAY_STATES, HAZARD_KEYS, type AmenityValue, type MuniFile, type MuniIndexFile } from '../shared/types.ts'
import { hazardMask, isRestrictedOnly, kindFlags } from './lib/facility.ts'
import { BUILD_DIR, FACILITIES_NDJSON, INTERMEDIATE_DIR } from './lib/paths.ts'
import { tileProps } from './lib/tileProps.ts'

export const DERIVED_REPORT = join(INTERMEDIATE_DIR, 'derived-report.json')
const defs = amenityDefs.amenities as ScoringDef[]
const muniDir = join(BUILD_DIR, 'facilities', 'by-muni')
mkdirSync(muniDir, { recursive: true })
mkdirSync(INTERMEDIATE_DIR, { recursive: true })

async function getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`${url}: ${res.status}`)
  return (await res.json()) as T
}

// 1) 市区町村 JSON。手元になければ公開済みのものを取得する
if (readdirSync(muniDir).length === 0) {
  const base = (process.env.VITE_DATA_BASE_URL ?? '').replace(/\/+$/, '')
  if (!base) throw new Error('市区町村 JSON が手元になく、VITE_DATA_BASE_URL も未設定です')
  console.log(`公開済みの施設データを取得します: ${base}`)
  const index = await getJson<MuniIndexFile>(`${base}/summary/munis.json`)
  writeFileSync(join(BUILD_DIR, 'meta.json'), JSON.stringify(await getJson(`${base}/meta.json`), null, 1))
  const keys = index.prefs.flatMap((p) => p.munis.map((m) => m.key))
  const queue = [...keys]
  await Promise.all(Array.from({ length: 16 }, async () => {
    for (let k = queue.pop(); k; k = queue.pop()) {
      writeFileSync(join(muniDir, `${k}.json`), JSON.stringify(await getJson(`${base}/facilities/by-muni/${k}.json`)))
    }
  }))
  console.log(`  ${keys.length} 市区町村`)
}

// 2) 確定設備値。読み取りに失敗したら中断する（失敗を「設備情報なし」として上書きしない）
const amenities = new Map<string, Record<string, AmenityValue>>()
if (process.env.RESCORE_FIXTURE) {
  // 手元での表示確認用。本番のビルドでは使わない
  const fixture = JSON.parse(readFileSync(process.env.RESCORE_FIXTURE, 'utf8')) as Record<string, Record<string, AmenityValue>>
  for (const [id, a] of Object.entries(fixture)) amenities.set(id, a)
  console.log(`確認用の設備値を使います（${amenities.size} 施設）`)
} else {
  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY が未設定です')
  let rows = 0
  for (let from = 0; ; from += 1000) {
    const page = await getJson<({ facility_id: string; amenity_key: string } & AmenityValue)[]>(
      `${url}/rest/v1/facility_amenities?select=facility_id,amenity_key,value,confidence,observed_at,evidence_count&order=facility_id,amenity_key&offset=${from}&limit=1000`,
      { apikey: key },
    )
    for (const { facility_id, amenity_key, ...v } of page) {
      const a = amenities.get(facility_id) ?? {}
      a[amenity_key] = v
      amenities.set(facility_id, a)
    }
    rows += page.length
    if (page.length < 1000) break
  }
  console.log(`確定設備値: ${rows} 件（${amenities.size} 施設）`)
}

// 3) 設備値を載せて算出し直す。内容が変わった市区町村だけ書き出す
const now = new Date().toISOString()
const ndjson: string[] = []
const stats = {
  facility_count: 0,
  by_kind: { emergency_only: 0, shelter_only: 0, both: 0 },
  restricted_only_count: 0,
  hazards: Object.fromEntries(HAZARD_KEYS.map((k) => [k, 0])) as Record<string, number>,
  display_state: Object.fromEntries(DISPLAY_STATES.map((s) => [s, 0])) as Record<string, number>,
  facilities_with_any_amenity: 0,
  axis_evaluated: { habitability: 0, logistics: 0 },
  hazard_status: { attention: 0, no_overlap_found: 0, not_evaluated: 0 } as Record<string, number>,
}
const munis: { key: string; prefCode: string; prefName: string; muniName: string; count: number }[] = []
let changedMunis = 0
const used = new Set<string>()
for (const file of readdirSync(muniDir).sort()) {
  const path = join(muniDir, file)
  const muni = JSON.parse(readFileSync(path, 'utf8')) as MuniFile
  let changed = false
  // 多くの施設で同じになる文章は、市区町村ごとの表に 1 回だけ置く（データを小さくするため。内容は落とさない）
  const texts: unknown[] = []
  const textIndex = new Map<string, number>()
  // 先に全施設を算出し、軸ごとの根拠がまるごと同じ施設が 2 つ以上あるものを調べる（それらは表に 1 回だけ置く）
  const fullScores = muni.facilities.map((f) => computeScores(amenities.get(f.id) ?? {}, defs, f.designations.emergency_site, f.road))
  const seen = new Map<string, number>()
  for (const s of fullScores) {
    for (const [axis, value] of Object.entries(s.breakdown)) {
      if (typeof value !== 'object' || value === null) continue
      const k = axisKey(axis, value)
      seen.set(k, (seen.get(k) ?? 0) + 1)
    }
  }
  const shared = new Set([...seen].filter(([, n]) => n >= 2).map(([k]) => k))
  for (const [i, f] of muni.facilities.entries()) {
    const next = amenities.get(f.id) ?? {}
    if (amenities.has(f.id)) used.add(f.id)
    const full = fullScores[i]!
    const scores = { ...full, breakdown: compactBreakdown(full.breakdown, texts, textIndex, shared) }
    if (JSON.stringify(f.amenities) !== JSON.stringify(next) || JSON.stringify(f.scores) !== JSON.stringify(scores)) {
      f.amenities = next
      f.scores = scores
      changed = true
    }
    const kind = kindFlags(f)
    const hz = hazardMask(f)
    stats.facility_count++
    if (kind === 1) stats.by_kind.emergency_only++
    else if (kind === 2) stats.by_kind.shelter_only++
    else stats.by_kind.both++
    if (isRestrictedOnly(f)) stats.restricted_only_count++
    HAZARD_KEYS.forEach((k, i) => { if (hz & (1 << i)) stats.hazards[k]!++ })
    stats.display_state[f.scores.display_state]!++
    if (Object.keys(f.amenities).length > 0) stats.facilities_with_any_amenity++
    if (f.scores.habitability !== null) stats.axis_evaluated.habitability++
    if (f.scores.logistics !== null) stats.axis_evaluated.logistics++
    stats.hazard_status[f.scores.hazard_check.status]!++
    ndjson.push(JSON.stringify({
      type: 'Feature', geometry: { type: 'Point', coordinates: [f.lng, f.lat] }, properties: tileProps(f, muni.muni_key),
    }))
  }
  if (JSON.stringify(muni.breakdown_texts ?? []) !== JSON.stringify(texts)) changed = true
  if (changed) {
    muni.generated_at = now
    // 文章の表は facilities より前に書く（読み込みには関係ないが、ファイルを開いたときに先に目に入るように）
    const { facilities, ...head } = muni
    delete head.breakdown_texts
    writeFileSync(path, JSON.stringify({ ...head, breakdown_texts: texts, facilities }))
    changedMunis++
  }
  munis.push({ key: muni.muni_key, prefCode: muni.pref_code, prefName: muni.pref_name, muniName: muni.muni_name, count: muni.facilities.length })
}
writeFileSync(FACILITIES_NDJSON, ndjson.join('\n') + '\n')
writeFileSync(DERIVED_REPORT, JSON.stringify({ generated_at: now, ...stats, muni_count: munis.length, munis }))

const orphan = [...amenities.keys()].filter((id) => !used.has(id))
console.log(`施設 ${stats.facility_count} 件 / 設備情報あり ${stats.facilities_with_any_amenity} 件 / 軸C 評価済み ${stats.axis_evaluated.habitability} 件`)
console.log('表示状態:', stats.display_state)
console.log('軸A:', stats.hazard_status, '/ 軸D 評価済み:', stats.axis_evaluated.logistics)
console.log(`書き換えた市区町村: ${changedMunis}`)
if (orphan.length > 0) console.log(`施設データにない施設の設備値（廃止済みなど）: ${orphan.length} 件`)
