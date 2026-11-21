// 全国集計・市区町村の索引・meta.json を生成する（SPEC §2.4、§5.6）
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import amenityDefs from '../config/amenity-defs.json' with { type: 'json' }
import { INQUIRY_STATUSES, inquiryStatus, validateInquiryLog, type InquiryLogFile, type InquirySummaryFile, type InquiryValuesFile } from '../shared/inquiry.ts'
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
for (const m of report.munis as { key: string; prefCode: string; prefName: string; muniName: string; count: number; shelters?: number; deep3?: number; landslide?: number }[]) {
  const p = prefs.get(m.prefCode) ?? { code: m.prefCode, name: m.prefName, count: 0, munis: [] }
  p.count += m.count
  p.munis.push({ key: m.key, name: m.muniName, count: m.count, ...(m.shelters !== undefined ? { shelters: m.shelters, deep3: m.deep3, landslide: m.landslide } : {}) })
  prefs.set(m.prefCode, p)
}
const muniIndex: MuniIndexFile = {
  generated_at: generatedAt,
  prefs: [...prefs.values()].sort((a, b) => a.code.localeCompare(b.code)),
}
writeFileSync(join(summaryDir, 'munis.json'), JSON.stringify(muniIndex))

// 照会の記録（docs/INQUIRY.md）。記録の検査に通らなければ止める。照会先の一覧と記録を合わせて公開用にまとめる（順位・点数は付けない）
{
  const dir = join(import.meta.dirname, '..', 'data', 'inquiry')
  const logPath = join(dir, 'log.json')
  const targetsPath = join(dir, 'targets.json')
  if (existsSync(logPath) && existsSync(targetsPath)) {
    const log = JSON.parse(readFileSync(logPath, 'utf8')) as InquiryLogFile
    const errors = validateInquiryLog(log, new Set(muniIndex.prefs.flatMap((p) => p.munis.map((m) => m.key))))
    if (errors.length) throw new Error(`照会の記録に誤りがあります：\n${errors.join('\n')}`)
    const t = JSON.parse(readFileSync(targetsPath, 'utf8')) as { condition: Record<string, number>; targets: { key: string; pref: string; name: string }[] }
    const withValues = new Map<string, number>()
    if (existsSync(join(dir, 'values'))) {
      for (const f of readdirSync(join(dir, 'values')).filter((x) => x.endsWith('.json'))) {
        const v = JSON.parse(readFileSync(join(dir, 'values', f), 'utf8')) as InquiryValuesFile
        withValues.set(v.muni_key, (withValues.get(v.muni_key) ?? 0) + Object.keys(v.values).length)
      }
    }
    const names = new Map(muniIndex.prefs.flatMap((p) => p.munis.map((m) => [m.key, { pref: p.name, name: m.name }] as const)))
    const keys = [...new Set([...t.targets.map((x) => x.key), ...Object.keys(log.munis)])].sort()
    const targetSet = new Set(t.targets.map((x) => x.key))
    const munis = keys.map((key) => {
      const events = log.munis[key]?.events ?? []
      return {
        key, pref: names.get(key)?.pref ?? '', name: names.get(key)?.name ?? '', target: targetSet.has(key),
        status: inquiryStatus(events), events: events.map((e) => { const { id, ...rest } = e; void id; return rest }), facilities_with_values: withValues.get(key) ?? 0,
      }
    })
    const counts = Object.fromEntries(INQUIRY_STATUSES.map((s) => [s, munis.filter((m) => m.status === s).length])) as InquirySummaryFile['counts']
    const summary: InquirySummaryFile = { generated_at: generatedAt, condition: t.condition, counts, munis }
    writeFileSync(join(summaryDir, 'inquiries.json'), JSON.stringify(summary))
    console.log(`照会の記録：${munis.length} 市区町村`, counts)
  }
}

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
