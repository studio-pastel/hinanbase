// 全国集計・市区町村の索引・meta.json を生成する（SPEC §2.4、§5.6）
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import amenityDefs from '../config/amenity-defs.json' with { type: 'json' }
import type { Meta, MuniIndexFile, NationalSummary, PrefIndexEntry } from '../shared/types.ts'
import { BUILD_DIR, BUILD_REPORT } from './lib/paths.ts'

export const SCHEMA_VERSION = 1

if (!existsSync(BUILD_REPORT)) throw new Error('先に build-facilities を実行してください')
const report = JSON.parse(readFileSync(BUILD_REPORT, 'utf8'))
const generatedAt = new Date().toISOString()
const summaryDir = join(BUILD_DIR, 'summary')
mkdirSync(summaryDir, { recursive: true })

const national: NationalSummary = {
  generated_at: generatedAt,
  facility_count: report.facility_count,
  muni_count: report.muni_count,
  by_kind: report.by_kind,
  restricted_only_count: report.restricted_only_count,
  hazards: report.hazards,
  // Phase 1 では設備情報が1件もないので、全施設が「未確認」。0 件であることを隠さず出す
  display_state: { unknown: report.facility_count, critical: 0, poor: 0, fair: 0, good: 0 },
  amenity_coverage: { facilities_with_any: 0, ratio: 0 },
}
writeFileSync(join(summaryDir, 'national.json'), JSON.stringify(national))

const prefs = new Map<string, PrefIndexEntry>()
for (const m of report.munis as { key: string; prefCode: string; prefName: string; muniName: string; count: number }[]) {
  const p = prefs.get(m.prefCode) ?? { code: m.prefCode, name: m.prefName, count: 0, munis: [] }
  p.count += m.count
  p.munis.push({ key: m.key, name: m.muniName, count: m.count })
  prefs.set(m.prefCode, p)
}
const muniIndex: MuniIndexFile = {
  generated_at: generatedAt,
  prefs: [...prefs.values()].sort((a, b) => a.code.localeCompare(b.code)),
}
writeFileSync(join(summaryDir, 'munis.json'), JSON.stringify(muniIndex))

const meta: Meta = {
  schema_version: SCHEMA_VERSION,
  generated_at: generatedAt,
  d1_fetched_date: report.d1_fetched_date,
  source_rows: report.source_rows,
  facility_count: report.facility_count,
  merge: report.merge,
  merge_candidates: report.merge_candidates,
}
writeFileSync(join(BUILD_DIR, 'meta.json'), JSON.stringify(meta, null, 1))
console.log(`全国 ${national.facility_count} 施設 / ${national.muni_count} 市区町村、設備項目マスタ ${amenityDefs.amenities.length} 項目`)
