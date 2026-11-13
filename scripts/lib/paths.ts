import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export const ROOT = join(import.meta.dirname, '..', '..')
export const RAW_DIR = join(ROOT, 'data', 'raw')
export const BUILD_DIR = join(ROOT, 'data', 'build')
export const INTERMEDIATE_DIR = join(BUILD_DIR, 'intermediate')
export const REGISTRY_PATH = join(ROOT, 'data', 'registry', 'facility-ids.csv')

/** タイル生成用の中間データ（改行区切り GeoJSON） */
export const FACILITIES_NDJSON = join(INTERMEDIATE_DIR, 'facilities.ndjson')
export const BUILD_REPORT = join(INTERMEDIATE_DIR, 'build-report.json')

/** data/raw/ の中で最も新しい取得日（YYYY-MM-DD）のフォルダを返す（DATA_NOTES D-9） */
export function latestSnapshot(): { date: string; shelterCsv: string; emergencyCsv: string } {
  const dates = existsSync(RAW_DIR)
    ? readdirSync(RAW_DIR).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort()
    : []
  const date = dates.at(-1)
  if (!date) throw new Error('data/raw/ に取得日（YYYY-MM-DD）のフォルダがありません')
  // _1 が指定避難所、_2 が指定緊急避難場所（DATA_NOTES 1章）
  const shelterCsv = join(RAW_DIR, date, 'mergeFromCity_1', 'mergeFromCity_1.csv')
  const emergencyCsv = join(RAW_DIR, date, 'mergeFromCity_2', 'mergeFromCity_2.csv')
  for (const p of [shelterCsv, emergencyCsv]) if (!existsSync(p)) throw new Error(`元データがありません: ${p}`)
  return { date, shelterCsv, emergencyCsv }
}
