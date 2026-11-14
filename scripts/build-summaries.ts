// 全国集計・市区町村の索引・meta.json を生成する（SPEC §2.4、§5.6）
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import amenityDefs from '../config/amenity-defs.json' with { type: 'json' }
import type { Meta, MuniIndexFile, NationalSummary, PrefIndexEntry } from '../shared/types.ts'
import { BUILD_DIR, BUILD_REPORT } from './lib/paths.ts'

export const SCHEMA_VERSION = 2

const DERIVED_REPORT = join(BUILD_DIR, 'intermediate', 'derived-report.json')
if (!existsSync(DERIVED_REPORT)) throw new Error('先に rescore を実行してください')
const report = JSON.parse(readFileSync(DERIVED_REPORT, 'utf8'))
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
  display_state: report.display_state,
  // 割合の低さを隠さない（SPEC §6.1）
  amenity_coverage: {
    facilities_with_any: report.facilities_with_any_amenity,
    ratio: report.facility_count === 0 ? 0 : report.facilities_with_any_amenity / report.facility_count,
  },
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

// meta.json：元データ由来の項目（取得日・行数・統合の内訳）は、取り込み時の報告があればそこから、
// なければ（日次ビルド）既存の meta.json から引き継ぐ
const metaPath = join(BUILD_DIR, 'meta.json')
const source = existsSync(BUILD_REPORT)
  ? JSON.parse(readFileSync(BUILD_REPORT, 'utf8'))
  : existsSync(metaPath)
    ? JSON.parse(readFileSync(metaPath, 'utf8'))
    : null
if (!source) throw new Error('meta.json の元になる情報がありません（build-facilities か、既存の meta.json が必要）')
const meta: Meta = {
  schema_version: SCHEMA_VERSION,
  generated_at: generatedAt,
  d1_fetched_date: source.d1_fetched_date,
  source_rows: source.source_rows,
  facility_count: report.facility_count,
  merge: source.merge,
  merge_candidates: source.merge_candidates,
}
writeFileSync(join(BUILD_DIR, 'meta.json'), JSON.stringify(meta, null, 1))
console.log(`全国 ${national.facility_count} 施設 / ${national.muni_count} 市区町村、設備項目マスタ ${amenityDefs.amenities.length} 項目`)
