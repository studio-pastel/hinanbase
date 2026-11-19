// 全施設の地点について、想定浸水深（洪水・津波・高潮）の階級と土砂災害の区域を、
// ハザードマップポータルサイトのタイルの色から読み、市区町村 JSON の depth に書き込む（DATA_NOTES 14.5）。
// 推定はしない。タイルの色をそのまま階級に置き換えるだけ。色のない地点は 0（想定区域の外とは限らない）。
//
//   npm run data:depth                  全国（取得済みのタイルは再取得しない）
//   npm run data:depth -- --dry-run     取得せず、まだ手元にないタイルの数だけ数える
//   npm run data:depth -- 13108 27100   市区町村を指定
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PNG } from 'pngjs'
import type { DepthRank, MuniFile, PointDepth } from '../shared/types.ts'
import { getTile, readPng, requests, tileOf } from './fetch-hazards.ts'
import { BUILD_DIR, ROOT } from './lib/paths.ts'

const ZOOM = 15
const FALLBACK_ZOOM = 14
const COARSE_ZOOM = 10
const CONCURRENCY = 12
const CACHE_DIR = join(ROOT, 'data', 'cache', 'hazard-tiles')

/** 浸水深の色（ハザードマップポータルサイトの凡例。2026-11-20 に凡例画像と照合）→ 階級 */
const DEPTH_COLORS: Record<string, Exclude<DepthRank, 0>> = {
  '255,255,179': 1, // 0.3m 未満
  '247,245,169': 1, // 0.5m 未満
  '248,225,166': 2, // 0.5〜1m
  '255,216,192': 2, // 0.5〜3m
  '255,183,183': 3, // 3〜5m
  '255,145,145': 4, // 5〜10m
  '242,133,201': 5, // 10〜20m
  '220,122,220': 5, // 20m 以上
}
const DEPTH_LAYERS = {
  flood: '01_flood_l2_shinsuishin_data',
  tsunami: '04_tsunami_newlegend_data',
  storm_surge: '03_hightide_l2_shinsuishin_data',
} as const
/** 土砂災害：赤系は特別警戒区域、それ以外の色は警戒区域 */
const LANDSLIDE_LAYERS = ['05_dosekiryukeikaikuiki', '05_kyukeishakeikaikuiki', '05_jisuberikeikaikuiki']
const isSpecial = (r: number, g: number, b: number) => r >= 160 && g <= 60 && b <= 60

const dryRun = process.argv.includes('--dry-run')
const only = process.argv.slice(2).filter((a) => /^\d{5}$/.test(a))

const decoded = new Map<string, PNG | undefined>()
function pixel(key: string, buf: Buffer, px: number, py: number): [number, number, number, number] | undefined {
  if (!decoded.has(key)) {
    if (decoded.size > 600) decoded.clear()
    decoded.set(key, readPng(buf))
  }
  const png = decoded.get(key)
  if (!png) return undefined
  const i = (py * png.width + px) * 4
  return [png.data[i]!, png.data[i + 1]!, png.data[i + 2]!, png.data[i + 3]!]
}

let missing = 0
const missingKeys = new Set<string>()
/** 手元のタイルだけを見る（dry-run 用）。ない場合は数える */
function cached(layer: string, z: number, x: number, y: number): Buffer | null | undefined {
  const file = join(CACHE_DIR, layer, String(z), String(x), `${y}.png`)
  if (existsSync(file)) return readFileSync(file)
  if (existsSync(`${file}.404`)) return null
  const k = `${layer}/${z}/${x}/${y}`
  if (!missingKeys.has(k)) { missingKeys.add(k); missing++ }
  return undefined
}
const tile = (layer: string, z: number, x: number, y: number) => (dryRun ? Promise.resolve(cached(layer, z, x, y)) : getTile(layer, z, x, y))

/** 地点の色。データのない一帯なら null、取得できなければ undefined */
async function colorAt(layer: string, lat: number, lng: number): Promise<[number, number, number, number] | null | undefined> {
  const c = tileOf(lat, lng, COARSE_ZOOM)
  const coarse = await tile(layer, COARSE_ZOOM, c.x, c.y)
  if (coarse === undefined) return undefined
  if (coarse === null) return null
  // 手元にズーム 15（1 画素約 5m）があればそれを使う。なければズーム 14（約 10m）を取得する（取得枚数を約 4 分の 1 にするため）
  let z = ZOOM
  let t = tileOf(lat, lng, z)
  if (!existsSync(join(CACHE_DIR, layer, String(z), String(t.x), `${t.y}.png`)) && !existsSync(join(CACHE_DIR, layer, String(z), String(t.x), `${t.y}.png.404`))) {
    z = FALLBACK_ZOOM
    t = tileOf(lat, lng, z)
  }
  const fine = await tile(layer, z, t.x, t.y)
  if (fine === undefined) return undefined
  if (fine === null) return [0, 0, 0, 0]
  return pixel(`${layer}/${z}/${t.x}/${t.y}`, fine, t.px, t.py)
}

async function depthOf(lat: number, lng: number): Promise<PointDepth> {
  const out: PointDepth = { checked_at: new Date().toISOString().slice(0, 10) }
  for (const [k, layer] of Object.entries(DEPTH_LAYERS) as [keyof typeof DEPTH_LAYERS, string][]) {
    const c = await colorAt(layer, lat, lng)
    if (!c) continue // データがない一帯・取得できない：項目を作らない（未確認）
    if (c[3] < 128) { out[k] = 0; continue }
    const rank = DEPTH_COLORS[`${c[0]},${c[1]},${c[2]}`]
    if (rank !== undefined) out[k] = rank // 凡例にない色は書かない
  }
  let ls: 0 | 1 | 2 | undefined
  for (const layer of LANDSLIDE_LAYERS) {
    const c = await colorAt(layer, lat, lng)
    if (c === undefined) { ls = undefined; break }
    if (c === null) continue
    const v = c[3] < 128 ? 0 : isSpecial(c[0], c[1], c[2]) ? 2 : 1
    ls = Math.max(ls ?? 0, v) as 0 | 1 | 2
  }
  if (ls !== undefined) out.landslide = ls
  return out
}

const muniDir = join(BUILD_DIR, 'facilities', 'by-muni')
const files = readdirSync(muniDir).filter((f) => only.length === 0 || only.includes(f.slice(0, 5))).sort()
const counts = { facilities: 0, flood: [0, 0, 0, 0, 0, 0], tsunami: [0, 0, 0, 0, 0, 0], storm_surge: [0, 0, 0, 0, 0, 0], landslide: [0, 0, 0] }
const started = Date.now()
for (const [i, file] of files.entries()) {
  const path = join(muniDir, file)
  const muni = JSON.parse(readFileSync(path, 'utf8')) as MuniFile
  const queue = [...muni.facilities]
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      const d = await depthOf(f.lat, f.lng)
      counts.facilities++
      for (const k of ['flood', 'tsunami', 'storm_surge'] as const) if (d[k] !== undefined) counts[k][d[k]]!++
      if (d.landslide !== undefined) counts.landslide[d.landslide]!++
      if (!dryRun) f.depth = d
    }
  }))
  if (!dryRun) writeFileSync(path, JSON.stringify(muni))
  if ((i + 1) % 50 === 0 || i === files.length - 1) {
    console.log(`  ${i + 1} / ${files.length} 市区町村 / 施設 ${counts.facilities} / ${dryRun ? `手元にないタイル ${missing}` : `取得 ${requests}`} / ${Math.round((Date.now() - started) / 1000)} 秒`)
  }
}
console.log(JSON.stringify(counts))
if (!dryRun) console.log('このあと npm run data:rescore → data:tiles で地図に反映する')
