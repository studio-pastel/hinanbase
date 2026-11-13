// D1 の CSV 2本を読み、施設に統合して、市区町村 JSON と中間データを生成する（SPEC §5.6）
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { HAZARD_KEYS, type Facility, type MuniFile } from '../shared/types.ts'
import {
  buildFacility, hazardMask, isRestrictedOnly, kindFlags, splitMuniLabel,
} from './lib/facility.ts'
import { mergeRows } from './lib/merge.ts'
import {
  BUILD_DIR, BUILD_REPORT, FACILITIES_NDJSON, INTERMEDIATE_DIR, REGISTRY_PATH, latestSnapshot,
} from './lib/paths.ts'
import { assignFacilityIds, formatRegistry, parseRegistry } from './lib/registry.ts'
import { readSourceCsv } from './lib/source.ts'

const snapshot = latestSnapshot()
console.log(`取得日 ${snapshot.date} の元データを読み込みます`)
const shelterRows = readSourceCsv(snapshot.shelterCsv, 'shelter')
const emergencyRows = readSourceCsv(snapshot.emergencyCsv, 'emergency')
const rows = [...shelterRows, ...emergencyRows]

const { clusters, candidates } = mergeRows(rows)
const previous = existsSync(REGISTRY_PATH) ? parseRegistry(readFileSync(REGISTRY_PATH, 'utf8')) : []
const assigned = assignFacilityIds(clusters, previous, snapshot.date)

const generatedAt = new Date().toISOString()
const muniDir = join(BUILD_DIR, 'facilities', 'by-muni')
rmSync(muniDir, { recursive: true, force: true })
mkdirSync(muniDir, { recursive: true })
mkdirSync(INTERMEDIATE_DIR, { recursive: true })

const byMuni = new Map<string, { label: string; facilities: Facility[] }>()
clusters.forEach((c, i) => {
  const rep = c.members[0]!
  const f = buildFacility(assigned.ids[i]!, c)
  const m = byMuni.get(rep.muniKey) ?? { label: rep.muniLabel, facilities: [] }
  if (m.label !== rep.muniLabel) throw new Error(`市区町村コード ${rep.muniKey} に名称が複数あります`)
  m.facilities.push(f)
  byMuni.set(rep.muniKey, m)
})

const ndjson: string[] = []
const muniIndex: { key: string; prefCode: string; prefName: string; muniName: string; count: number }[] = []
const ruleCounts: Record<string, number> = {}
const stats = {
  facility_count: 0,
  by_kind: { emergency_only: 0, shelter_only: 0, both: 0 },
  restricted_only_count: 0,
  hazards: Object.fromEntries(HAZARD_KEYS.map((k) => [k, 0])) as Record<string, number>,
  designation_rows: { shelter: 0, emergency: 0 },
}
for (const muniKey of [...byMuni.keys()].sort()) {
  const { label, facilities } = byMuni.get(muniKey)!
  const { prefCode, prefName, muniName } = splitMuniLabel(muniKey, label)
  facilities.sort((a, b) => (a.id < b.id ? -1 : 1))
  const file: MuniFile = {
    muni_key: muniKey, pref_code: prefCode, pref_name: prefName, muni_name: muniName,
    generated_at: generatedAt, facilities,
  }
  writeFileSync(join(muniDir, `${muniKey}.json`), JSON.stringify(file))
  muniIndex.push({ key: muniKey, prefCode, prefName, muniName, count: facilities.length })
  for (const f of facilities) {
    const kind = kindFlags(f)
    const hz = hazardMask(f)
    const restrictedOnly = isRestrictedOnly(f)
    stats.facility_count++
    if (kind === 1) stats.by_kind.emergency_only++
    else if (kind === 2) stats.by_kind.shelter_only++
    else stats.by_kind.both++
    if (restrictedOnly) stats.restricted_only_count++
    HAZARD_KEYS.forEach((k, i) => { if (hz & (1 << i)) stats.hazards[k]!++ })
    stats.designation_rows.shelter += f.designations.shelter.length
    stats.designation_rows.emergency += f.designations.emergency_site.length
    for (const r of f.merge_rules) ruleCounts[r] = (ruleCounts[r] ?? 0) + 1
    // タイルの属性（SPEC §2.4）。ne/ns/h0〜h7 は低ズームのまとめ表示で件数を合算するための 0/1
    const props: Record<string, string | number> = {
      id: f.id, name: f.name, muni: muniKey, kind, hz, state: f.scores.display_state,
      rs: restrictedOnly ? 1 : 0,
      ne: kind & 1 ? 1 : 0, ns: kind & 2 ? 1 : 0,
    }
    HAZARD_KEYS.forEach((_, i) => { props[`h${i}`] = hz & (1 << i) ? 1 : 0 })
    ndjson.push(JSON.stringify({ type: 'Feature', geometry: { type: 'Point', coordinates: [f.lng, f.lat] }, properties: props }))
  }
}

// 行数の突き合わせ：元データの全行が、ちょうど1つの施設の指定として出力されていること
if (stats.designation_rows.shelter !== shelterRows.length || stats.designation_rows.emergency !== emergencyRows.length) {
  throw new Error('出力した指定の行数が元データの行数と一致しません')
}

writeFileSync(FACILITIES_NDJSON, ndjson.join('\n') + '\n')
const candidateCounts: Record<string, number> = {}
for (const c of candidates) candidateCounts[c.rule] = (candidateCounts[c.rule] ?? 0) + 1
writeFileSync(
  join(BUILD_DIR, 'merge_candidates.json'),
  JSON.stringify({ generated_at: generatedAt, d1_fetched_date: snapshot.date, counts: candidateCounts, candidates }, null, 1),
)
mkdirSync(dirname(REGISTRY_PATH), { recursive: true })
writeFileSync(REGISTRY_PATH, formatRegistry(assigned.registry))

const report = {
  generated_at: generatedAt,
  d1_fetched_date: snapshot.date,
  source_rows: { shelter: shelterRows.length, emergency: emergencyRows.length },
  ...stats,
  muni_count: muniIndex.length,
  merge: ruleCounts,
  merge_candidates: candidateCounts,
  registry: {
    entries: assigned.registry.length, minted: assigned.minted,
    remapped: assigned.remapped.length, deprecated: assigned.deprecated.length,
  },
  deprecated_facility_ids: assigned.deprecated,
  remapped: assigned.remapped,
  munis: muniIndex,
}
writeFileSync(BUILD_REPORT, JSON.stringify(report))

console.log(`元データ: 避難所 ${shelterRows.length} 行 + 緊急避難場所 ${emergencyRows.length} 行 = ${rows.length} 行`)
console.log(`施設: ${stats.facility_count} 件（緊急避難場所のみ ${stats.by_kind.emergency_only} / 避難所のみ ${stats.by_kind.shelter_only} / 両方 ${stats.by_kind.both}）`)
console.log(`市区町村: ${muniIndex.length}`)
console.log('統合規則を適用した施設数:', ruleCounts)
console.log('人手判断の候補:', candidateCounts)
console.log(`対応表: ${assigned.registry.length} 行（新規採番 ${assigned.minted} / 付け替え ${assigned.remapped.length} / 消えた施設 ${assigned.deprecated.length}）`)
