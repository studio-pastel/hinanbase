// 自治体の収容人数 CSV（data/raw/d3/{取得日}/{市区町村コード5桁}.csv）を読み、施設との突き合わせを試す。
// 結果を表示するだけで、施設データには書き込まない（取り込み方は未決。DATA_NOTES 12.11）。
//   npm run data:capacity-check
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MuniFile } from '../shared/types.ts'
import { decodeCsv, matchCapacity, readCapacityRows } from './lib/capacity.ts'
import { BUILD_DIR, RAW_DIR } from './lib/paths.ts'

const root = join(RAW_DIR, 'd3')
const date = existsSync(root) ? readdirSync(root).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().at(-1) : undefined
if (!date) throw new Error('data/raw/d3/ に取得日（YYYY-MM-DD）のフォルダがありません')
const total = { rows: 0, withPersons: 0, matched: 0, usable: 0, facilities: 0 }
for (const file of readdirSync(join(root, date)).filter((f) => /^\d{5}\.csv$/.test(f)).sort()) {
  const key = file.slice(0, 5)
  const muniPath = join(BUILD_DIR, 'facilities', 'by-muni', `${key}.json`)
  if (!existsSync(muniPath)) { console.log(`${key}: 施設データに市区町村がありません`); continue }
  const muni = JSON.parse(readFileSync(muniPath, 'utf8')) as MuniFile
  const rows = readCapacityRows(decodeCsv(readFileSync(join(root, date, file))))
  if (!rows) { console.log(`${key} ${muni.muni_name}: 名称または収容人数の列が見つかりません`); continue }
  const { matched, unmatched } = matchCapacity(rows, muni.facilities)
  const usable = matched.filter((m) => m.row.persons !== null)
  const by = (m: string) => matched.filter((x) => x.method === m).length
  const targets = new Set(usable.map((m) => m.facility.id))
  // 同じ施設に、値の違う行が複数対応した数（建物と校庭など）
  const conflicts = [...targets].filter((id) => new Set(usable.filter((m) => m.facility.id === id).map((m) => m.row.persons)).size > 1).length
  const shelterTargets = [...targets].filter((id) => muni.facilities.find((f) => f.id === id)!.designations.shelter.length > 0).length
  const unreadable = rows.filter((r) => r.raw !== '' && r.persons === null).map((r) => r.raw)
  console.log(
    `${key} ${muni.pref_name}${muni.muni_name}: 行 ${rows.length} / 人数あり ${rows.filter((r) => r.persons !== null).length}` +
    ` / 対応 ${matched.length}（共通ID ${by('source_id')}・名称と位置 ${by('name_and_location')}・名称のみ ${by('name_only')}）` +
    ` / 対応なし ${unmatched.length} / 人数が付く施設 ${targets.size}（うち指定避難所あり ${shelterTargets}、値が食い違う ${conflicts}）／市内の施設 ${muni.facilities.length}`,
  )
  if (unreadable.length > 0) console.log(`   読み取れなかった値: ${[...new Set(unreadable)].slice(0, 5).join(' | ')}`)
  if (unmatched.length > 0) console.log(`   対応なしの例: ${unmatched.slice(0, 5).map((r) => r.name).join('、')}`)
  total.rows += rows.length
  total.withPersons += rows.filter((r) => r.persons !== null).length
  total.matched += matched.length
  total.usable += usable.length
  total.facilities += targets.size
}
console.log('合計:', total)
