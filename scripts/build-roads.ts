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
import { contains, LandIndex, makePart, type LandPart } from './lib/land.ts'
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

// 5km 以上離れている施設について、同じ陸地に緊急輸送道路の指定があるかを調べる準備（DATA_NOTES D-29）。
// 行政区域データ（N03、CC BY 4.0）の zip を data/raw/n03/{取得日}/ に置く。なければこの判定は行わない。
const FAR_M = 5000
const n03Root = join(RAW_DIR, 'n03')
const n03Date = existsSync(n03Root) ? readdirSync(n03Root).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().at(-1) : undefined
const n03Zips = n03Date ? readdirSync(join(n03Root, n03Date)).filter((f) => /^N03-\d+_\d{2}_GML\.zip$/.test(f)).sort() : []
let land: LandIndex | undefined
if (n03Zips.length === 47) {
  // 先に、5km 以上離れている施設の位置を集める。面はその近くのものだけ残す（全国分を持つと大きすぎる）
  const far: { lat: number; lng: number }[] = []
  for (const file of readdirSync(muniDir)) {
    const muni = JSON.parse(readFileSync(join(muniDir, file), 'utf8')) as MuniFile
    for (const f of muni.facilities) {
      if (f.designations.shelter.length === 0) continue
      const d = index.nearest(f.lat, f.lng).distance_m
      if (d !== null && d >= FAR_M) far.push(f)
    }
  }
  const MARGIN = 0.5 // 度。施設からこの範囲にかかる面だけ残す
  const nearCells = new Set<string>()
  for (const p of far) {
    for (let x = Math.floor((p.lng - MARGIN) * 2); x <= Math.floor((p.lng + MARGIN) * 2); x++) {
      for (let y = Math.floor((p.lat - MARGIN) * 2); y <= Math.floor((p.lat + MARGIN) * 2); y++) nearCells.add(`${x},${y}`)
    }
  }
  const isNear = (p: LandPart) => {
    for (let x = Math.floor(p.minX * 2); x <= Math.floor(p.maxX * 2); x++) {
      for (let y = Math.floor(p.minY * 2); y <= Math.floor(p.maxY * 2); y++) if (nearCells.has(`${x},${y}`)) return true
    }
    return false
  }
  land = new LandIndex()
  for (const zip of n03Zips) {
    const name = zip.replace(/_GML\.zip$/, '.geojson')
    const text = execFileSync('unzip', ['-p', zip, `*${name}`], { cwd: join(n03Root, n03Date!), maxBuffer: 2 ** 31 - 1 }).toString('utf8')
    const g = JSON.parse(text) as { features: { geometry: { type: string; coordinates: number[][][] | number[][][][] } | null }[] }
    for (const f of g.features) {
      if (!f.geometry) continue
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates as number[][][]] : (f.geometry.coordinates as number[][][][])
      for (const poly of polys) {
        const part = makePart(poly[0]!)
        if (isNear(part)) land.add(part)
      }
    }
  }
  console.log(`行政区域の面: ${land.size}（5km 以上離れている ${far.length} 施設の周辺だけ）`)
} else {
  console.log(`注意: data/raw/n03/ に行政区域データが 47 件そろっていません（${n03Zips.length} 件）。「同じ陸地に道路があるか」の判定は行いません`)
}
const hasRoadIn = (p: LandPart) => index.someVertexIn(p.minX, p.minY, p.maxX, p.maxY, (x, y) => contains(p, x, y))
const landCounts: Record<string, number> = { has_road: 0, no_road: 0, large_land: 0, outside: 0 }

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
    if (land && road.distance_m !== null && road.distance_m >= FAR_M) {
      road.land = land.check(f.lng, f.lat, hasRoadIn)
      landCounts[road.land]!++
    }
    f.road = road
    targets++
    const d = road.distance_m
    bins[d === null ? 'not_found' : d < 500 ? 'under_500' : d < 2000 ? 'under_2000' : d < 5000 ? 'under_5000' : 'over_5000']++
  }
  if (!dryRun) writeFileSync(path, JSON.stringify(muni))
}
console.log(`指定避難所のある施設 ${targets} 件 / 道路データがなく対象外にした市区町村 ${skippedMunis}`)
console.log('直線距離の内訳:', bins)
if (land) console.log('5km 以上の施設の、同じ陸地の道路:', landCounts)
if (dryRun) {
  console.log('--dry-run のため、書き込んでいません')
} else {
  mkdirSync(INTERMEDIATE_DIR, { recursive: true })
  writeFileSync(join(INTERMEDIATE_DIR, 'road-report.json'), JSON.stringify({ built_at: new Date().toISOString(), n10_date: date, n03_date: land ? n03Date : null, prefs: prefs.size, roads: index.roadCount, targets, bins, land: land ? landCounts : null }))
  console.log('このあと npm run data:rescore で点数と表示状態に反映する')
}
