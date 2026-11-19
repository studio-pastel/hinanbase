// 軸A 用：緊急避難場所の各指定について、指定された災害種別の想定区域（ハザードマップポータルサイトのタイル）と
// 地点が重なるかを調べ、結果を市区町村 JSON に書き込む（SPEC §3.2、DATA_NOTES 12章）。
//
//   npm run data:hazards                 全国（時間がかかる。途中で止めても、取得済みのタイルは再取得しない）
//   npm run data:hazards -- 13108 27100  市区町村を指定して実行
//
// 相手のサーバーに負荷をかけないよう、取得は間隔を空け、同時接続は少数にする。取得したタイルは data/cache/ に保存する。
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { PNG } from 'pngjs'
import { ZONE_CHECKABLE } from '../shared/score.ts'
import type { HazardKey, MuniFile, ZoneResult } from '../shared/types.ts'
import { BUILD_DIR, INTERMEDIATE_DIR, ROOT } from './lib/paths.ts'

const BASE = 'https://disaportaldata.gsi.go.jp/raster'
/** 災害種別ごとのタイル。土砂災害は 3 種類のどれかに入っていれば区域内とする */
export const LAYERS: Partial<Record<HazardKey, string[]>> = {
  flood: ['01_flood_l2_shinsuishin_data'],
  inland_flood: ['02_naisui_data'],
  storm_surge: ['03_hightide_l2_shinsuishin_data'],
  tsunami: ['04_tsunami_newlegend_data'],
  landslide: ['05_dosekiryukeikaikuiki', '05_kyukeishakeikaikuiki', '05_jisuberikeikaikuiki'],
}
/** 判定に使うズーム（1 画素が約 5m 四方）と、データの有無を粗く調べるズーム */
const ZOOM = 15
const COARSE_ZOOM = 10
const MIN_INTERVAL_MS = 250
const CONCURRENCY = 3
const CACHE_DIR = join(ROOT, 'data', 'cache', 'hazard-tiles')

export function tileOf(lat: number, lng: number, z: number): { x: number; y: number; px: number; py: number } {
  const n = 2 ** z
  const fx = ((lng + 180) / 360) * n
  const fy = ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n
  return { x: Math.floor(fx), y: Math.floor(fy), px: Math.floor((fx % 1) * 256), py: Math.floor((fy % 1) * 256) }
}

let lastStart = 0
export let requests = 0
async function throttle() {
  const wait = Math.max(0, lastStart + MIN_INTERVAL_MS - Date.now())
  lastStart = Date.now() + wait
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
}

/** タイルを取得する。データがない場所は null。取得に失敗したら undefined（結果を書かない） */
const inflight = new Map<string, Promise<Buffer | null | undefined>>()
export function getTile(layer: string, z: number, x: number, y: number): Promise<Buffer | null | undefined> {
  const key = `${layer}/${z}/${x}/${y}`
  const hit = inflight.get(key)
  if (hit) return hit
  const p = (async () => {
    const file = join(CACHE_DIR, `${key}.png`)
    if (existsSync(file)) return readFileSync(file)
    if (existsSync(`${file}.404`)) return null
    for (let attempt = 0; attempt < 4; attempt++) {
      await throttle()
      requests++
      try {
        const res = await fetch(`${BASE}/${key}.png`, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; data-build-script)' } })
        mkdirSync(dirname(file), { recursive: true })
        if (res.status === 404) { writeFileSync(`${file}.404`, ''); return null }
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer())
          writeFileSync(file, buf)
          return buf
        }
      } catch { /* 下で間隔を広げて再試行 */ }
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt))
    }
    return undefined
  })()
  inflight.set(key, p)
  return p
}

const decoded = new Map<string, PNG>()
/** PNG を読む。末尾に余分なデータが付いたタイルがあるので、読めなければ IEND までで切って読み直す。それでも読めなければ undefined */
export function readPng(buf: Buffer): PNG | undefined {
  try {
    return PNG.sync.read(buf)
  } catch {
    const end = buf.indexOf(Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]))
    if (end < 0) return undefined
    try {
      return PNG.sync.read(buf.subarray(0, end + 8))
    } catch {
      return undefined
    }
  }
}
const unreadable = new Set<string>()
/** 地点の画素の不透明度。タイルが読めなければ undefined（「色なし」として扱わない） */
function alphaAt(key: string, buf: Buffer, px: number, py: number): number | undefined {
  let png = decoded.get(key)
  if (!png) {
    png = readPng(buf)
    if (!png) {
      if (!unreadable.has(key)) console.log(`  読めないタイル: ${key}（${buf.length} バイト）`)
      unreadable.add(key)
      return undefined
    }
    if (decoded.size > 400) decoded.clear()
    decoded.set(key, png)
  }
  return png.data[(py * png.width + px) * 4 + 3] ?? 0
}

/** 1 地点・1 災害種別の照合。取得に失敗したら undefined */
async function check(hazard: HazardKey, lat: number, lng: number): Promise<ZoneResult | undefined> {
  let failed = false
  for (const layer of LAYERS[hazard] ?? []) {
    const c = tileOf(lat, lng, COARSE_ZOOM)
    const coarse = await getTile(layer, COARSE_ZOOM, c.x, c.y)
    if (coarse === undefined) { failed = true; continue }
    if (coarse === null) continue // この一帯にデータなし
    // 配信元のタイルが壊れていて読めない場合は、1 段細かいズーム、1 段粗いズームの順に試す
    let result: 'in' | 'none' | undefined
    for (const z of [ZOOM, ZOOM + 1, ZOOM - 1]) {
      const t = tileOf(lat, lng, z)
      const tile = await getTile(layer, z, t.x, t.y)
      if (tile === undefined) break
      if (tile === null) { result = 'none'; break }
      const alpha = alphaAt(`${layer}/${z}/${t.x}/${t.y}`, tile, t.px, t.py)
      if (alpha === undefined) continue
      result = alpha > 0 ? 'in' : 'none'
      break
    }
    if (result === undefined) { failed = true; continue }
    if (result === 'in') return 'in'
  }
  return failed ? undefined : 'none'
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const muniDir = join(BUILD_DIR, 'facilities', 'by-muni')
  const only = process.argv.slice(2).filter((a) => /^\d{5}$/.test(a))
  const files = readdirSync(muniDir).filter((f) => only.length === 0 || only.includes(f.slice(0, 5))).sort()
  console.log(`対象: ${files.length} 市区町村`)
  const counts = { in: 0, none: 0, failed: 0, designations: 0 }
  const started = Date.now()
  for (const [i, file] of files.entries()) {
    const path = join(muniDir, file)
    const muni = JSON.parse(readFileSync(path, 'utf8')) as MuniFile
    // 照合する（指定 × 災害種別）を集め、少数ずつ並行して進める
    const tasks: { d: MuniFile['facilities'][number]['designations']['emergency_site'][number]; k: HazardKey }[] = []
    for (const f of muni.facilities) {
      for (const d of f.designations.emergency_site) {
        counts.designations++
        delete d.zone
        for (const k of ZONE_CHECKABLE) if (d.hazards[k]) tasks.push({ d, k })
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
      for (let t = tasks.shift(); t; t = tasks.shift()) {
        const r = await check(t.k, t.d.lat, t.d.lng)
        // 取得に失敗したものは結果を書かない（「色なし」として扱わない）
        if (r === undefined) { counts.failed++; continue }
        t.d.zone = { ...t.d.zone, [t.k]: r }
        counts[r]++
      }
    }))
    writeFileSync(path, JSON.stringify(muni))
    if ((i + 1) % 25 === 0 || i === files.length - 1) {
      console.log(`  ${i + 1} / ${files.length} 市区町村 / 取得 ${requests} 件 / 区域内 ${counts.in} / 色なし ${counts.none} / 失敗 ${counts.failed} / ${Math.round((Date.now() - started) / 1000)} 秒`)
    }
  }
  mkdirSync(INTERMEDIATE_DIR, { recursive: true })
  writeFileSync(join(INTERMEDIATE_DIR, 'hazard-report.json'), JSON.stringify({ checked_at: new Date().toISOString(), zoom: ZOOM, munis: files.length, requests, ...counts }))
  console.log('このあと npm run data:rescore で点数と表示状態に反映する')
}
