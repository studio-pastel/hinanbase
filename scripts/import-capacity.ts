// 自治体が公表している想定収容人数を、施設の「指定」ごとに市区町村 JSON へ書き込む（DATA_NOTES 12.11、D-28）。
//
//   npm run data:capacity               書き込む
//   npm run data:capacity -- --dry-run  書き込まずに、件数だけ表示する
//
// 元データは data/raw/d3/{取得日}/{市区町村コード5桁}.csv に手動で置く。
// 同じフォルダの sources.json に、市区町村ごとの出典（公表者・データ名・利用条件・掲載ページ・取得日）を書く。
// 出典の記載がない CSV は取り込まない（利用条件を確認していないデータを載せない）。
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MuniFile, PublishedCapacity } from '../shared/types.ts'
import { decodeCsv, matchCapacity, pickDesignation, readCapacityRows } from './lib/capacity.ts'
import { BUILD_DIR, INTERMEDIATE_DIR, RAW_DIR } from './lib/paths.ts'

const dryRun = process.argv.includes('--dry-run')
const root = join(RAW_DIR, 'd3')
const date = existsSync(root) ? readdirSync(root).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().at(-1) : undefined
if (!date) throw new Error('data/raw/d3/ に取得日（YYYY-MM-DD）のフォルダがありません')
const dir = join(root, date)
const sourcesPath = join(dir, 'sources.json')
if (!existsSync(sourcesPath)) throw new Error(`${sourcesPath} がありません（出典を確認できないデータは取り込みません）`)
const sources = JSON.parse(readFileSync(sourcesPath, 'utf8')) as Record<string, PublishedCapacity['source'] & { file_url?: string }>

const report: Record<string, unknown>[] = []
const total = { munis: 0, rows: 0, with_persons: 0, written: 0, facilities: 0 }
for (const file of readdirSync(dir).filter((f) => /^\d{5}\.csv$/.test(f)).sort()) {
  const key = file.slice(0, 5)
  const src = sources[key]
  const muniPath = join(BUILD_DIR, 'facilities', 'by-muni', `${key}.json`)
  if (!existsSync(muniPath)) { console.log(`${key}: 施設データに市区町村がありません。取り込みません`); continue }
  const muni = JSON.parse(readFileSync(muniPath, 'utf8')) as MuniFile
  if (!src) {
    // 出典を確認できていない CSV は取り込まない。以前に取り込んだ値が残っていれば消す
    let removed = 0
    for (const f of muni.facilities) for (const d of [...f.designations.emergency_site, ...f.designations.shelter]) if (d.capacity) { delete d.capacity; removed++ }
    if (removed > 0 && !dryRun) writeFileSync(muniPath, JSON.stringify(muni))
    console.log(`${key} ${muni.muni_name}: sources.json に出典がありません。取り込みません${removed > 0 ? `（以前の値 ${removed} 件を消しました）` : ''}`)
    continue
  }
  const rows = readCapacityRows(decodeCsv(readFileSync(join(dir, file))))
  if (!rows) { console.log(`${key} ${muni.muni_name}: 名称または収容人数の列が見つかりません`); continue }
  // 前回の取り込み結果を消してから付け直す
  for (const f of muni.facilities) for (const d of [...f.designations.emergency_site, ...f.designations.shelter]) delete d.capacity

  const { matched, unmatched } = matchCapacity(rows, muni.facilities)
  const source: PublishedCapacity['source'] = { publisher: src.publisher, title: src.title, license: src.license, page_url: src.page_url, fetched_date: src.fetched_date }
  // 指定ごとに集める。同じ指定に値の違う行が複数当たった場合は、どちらが正しいか決められないので付けない
  const byDesignation = new Map<string, { d: NonNullable<ReturnType<typeof pickDesignation>>; values: Map<number, { raw: string; name: string }> }>()
  const noDesignation: string[] = []
  for (const m of matched) {
    if (m.row.persons === null) continue
    const d = pickDesignation(m.row, m.facility)
    if (!d) { noDesignation.push(m.row.name); continue }
    const e = byDesignation.get(d.source_id) ?? { d, values: new Map<number, { raw: string; name: string }>() }
    e.values.set(m.row.persons, { raw: m.row.raw, name: m.row.name })
    byDesignation.set(d.source_id, e)
  }
  const conflicts: string[] = []
  let written = 0
  for (const { d, values } of byDesignation.values()) {
    if (values.size > 1) { conflicts.push(`${d.name}（${[...values.keys()].join(' / ')}）`); continue }
    const [persons, v] = [...values.entries()][0]!
    d.capacity = { persons, raw: v.raw, listed_name: v.name, source }
    written++
  }
  const facilities = muni.facilities.filter((f) => [...f.designations.emergency_site, ...f.designations.shelter].some((d) => d.capacity)).length
  if (!dryRun) writeFileSync(muniPath, JSON.stringify(muni))
  console.log(`${key} ${muni.pref_name}${muni.muni_name}: 行 ${rows.length} / 人数あり ${rows.filter((r) => r.persons !== null).length} / 書き込んだ指定 ${written}（${facilities} 施設） / 対応なし ${unmatched.length} / 値が食い違う ${conflicts.length}`)
  report.push({
    muni_key: key, muni_name: muni.muni_name, rows: rows.length, written, facilities,
    unmatched: unmatched.map((r) => ({ name: r.name, raw: r.raw })), conflicts, no_designation: noDesignation,
    unreadable: rows.filter((r) => r.raw !== '' && r.persons === null).map((r) => ({ name: r.name, raw: r.raw })),
  })
  total.munis++
  total.rows += rows.length
  total.with_persons += rows.filter((r) => r.persons !== null).length
  total.written += written
  total.facilities += facilities
}
console.log('合計:', total)
if (dryRun) console.log('--dry-run のため、書き込んでいません')
else {
  mkdirSync(INTERMEDIATE_DIR, { recursive: true })
  writeFileSync(join(INTERMEDIATE_DIR, 'capacity-report.json'), JSON.stringify({ built_at: new Date().toISOString(), d3_date: date, ...total, munis_detail: report }, null, 1))
  console.log('対応しなかった行は data/build/intermediate/capacity-report.json に出力しました')
}
