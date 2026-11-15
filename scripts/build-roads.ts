// 軸D 用：指定避難所の指定がある施設について、最寄りの緊急輸送道路までの直線距離を求め、
// 市区町村 JSON の road に書き込む（SPEC §3.5、DATA_NOTES 12.6）。
//
//   npm run data:roads               全国。結果を市区町村 JSON に書く
//   npm run data:roads -- --dry-run  書き込まずに、件数の内訳だけ表示する
//
// 元データは国土数値情報「緊急輸送道路」（N10、使用許諾条件は非商用。DATA_NOTES D-20）。
// 都道府県ごとの zip を data/raw/n10/{取得日}/ に手動で置く。zip のままでも、展開済みでもよい。
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MuniFile } from '../shared/types.ts'
import { BUILD_DIR, INTERMEDIATE_DIR, RAW_DIR } from './lib/paths.ts'
import { RoadIndex, type RoadFeature } from './lib/roads.ts'

const dryRun = process.argv.includes('--dry-run')
const n10Root = join(RAW_DIR, 'n10')
const date = existsSync(n10Root) ? readdirSync(n10Root).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().at(-1) : undefined
if (!date) throw new Error('data/raw/n10/ に取得日（YYYY-MM-DD）のフォルダがありません')
const dir = join(n10Root, date)

// zip は同じ場所に展開する（展開済みならそのまま使う）
for (const zip of readdirSync(dir).filter((f) => f.endsWith('.zip'))) {
  if (!existsSync(join(dir, zip.replace(/\.zip$/, '')))) execFileSync('unzip', ['-o', '-q', zip], { cwd: dir })
}
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => {
  const p = join(d, n)
  return statSync(p).isDirectory() ? walk(p) : [p]
})
const geojsons = walk(dir).filter((p) => /N10-\d+_\d{2}\.geojson$/.test(p)).sort()
if (geojsons.length === 0) throw new Error(`${dir} に N10 の GeoJSON がありません`)

const index = new RoadIndex()
const prefs = new Set<string>()
for (const p of geojsons) {
  index.add((JSON.parse(readFileSync(p, 'utf8')) as { features: RoadFeature[] }).features)
  prefs.add(p.match(/_(\d{2})\.geojson$/)![1]!)
}
console.log(`緊急輸送道路: ${prefs.size} 都道府県 / ${index.roadCount} 本 / 線分 ${index.segmentCount}（高速道路など ${index.excluded} 本は除外）`)
if (prefs.size < 47) console.log(`  注意: 47 都道府県そろっていません。道路データがない都道府県の施設には書き込みません（県境の施設は、隣の県のデータがないと実際より遠く出ます）`)

const muniDir = join(BUILD_DIR, 'facilities', 'by-muni')
const bins = { under_500: 0, under_2000: 0, under_5000: 0, over_5000: 0, not_found: 0 }
let targets = 0
let skippedMunis = 0
for (const file of readdirSync(muniDir).sort()) {
  // 道路データがない都道府県は、距離を出さない（未計算のままにする）
  if (!prefs.has(file.slice(0, 2))) { skippedMunis++; continue }
  const path = join(muniDir, file)
  const muni = JSON.parse(readFileSync(path, 'utf8')) as MuniFile
  for (const f of muni.facilities) {
    delete f.road
    if (f.designations.shelter.length === 0) continue
    const road = index.nearest(f.lat, f.lng)
    f.road = road
    targets++
    const d = road.distance_m
    bins[d === null ? 'not_found' : d < 500 ? 'under_500' : d < 2000 ? 'under_2000' : d < 5000 ? 'under_5000' : 'over_5000']++
  }
  if (!dryRun) writeFileSync(path, JSON.stringify(muni))
}
console.log(`指定避難所のある施設 ${targets} 件 / 道路データがなく対象外にした市区町村 ${skippedMunis}`)
console.log('直線距離の内訳:', bins)
if (dryRun) {
  console.log('--dry-run のため、書き込んでいません')
} else {
  mkdirSync(INTERMEDIATE_DIR, { recursive: true })
  writeFileSync(join(INTERMEDIATE_DIR, 'road-report.json'), JSON.stringify({ built_at: new Date().toISOString(), n10_date: date, prefs: prefs.size, roads: index.roadCount, targets, bins }))
  console.log('このあと npm run data:rescore で点数と表示状態に反映する')
}
