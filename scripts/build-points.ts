// 「住所から探す」で使う施設の位置と要約を、緯度経度 1 度ごとのファイル（points/{緯度}_{経度}.json）に書き出す（SPEC §6.6）。
// 表示状態などは日々変わるので、日次ビルドで作り直す。
//   npm run data:points
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PointRow } from '../shared/geocode.ts'
import type { MuniFile } from '../shared/types.ts'
import { hazardMask, isRestrictedOnly, kindFlags } from './lib/facility.ts'
import { BUILD_DIR } from './lib/paths.ts'

const muniDir = join(BUILD_DIR, 'facilities', 'by-muni')
const outDir = join(BUILD_DIR, 'points')
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
const cells = new Map<string, PointRow[]>()
for (const file of readdirSync(muniDir)) {
  const muni = JSON.parse(readFileSync(join(muniDir, file), 'utf8')) as MuniFile
  for (const f of muni.facilities) {
    const key = `${Math.floor(f.lat)}_${Math.floor(f.lng)}`
    const row: PointRow = [
      f.id, muni.muni_key, f.name, Math.round(f.lat * 1e5) / 1e5, Math.round(f.lng * 1e5) / 1e5,
      kindFlags(f), f.scores.display_state, isRestrictedOnly(f) ? 1 : 0, f.scores.hazard_check?.status === 'attention' ? 1 : 0, hazardMask(f),
    ]
    const list = cells.get(key)
    if (list) list.push(row)
    else cells.set(key, [row])
  }
}
for (const [key, rows] of cells) writeFileSync(join(outDir, `${key}.json`), JSON.stringify(rows))
console.log(`施設の位置ファイル: ${cells.size} 区画 / ${[...cells.values()].reduce((s, r) => s + r.length, 0)} 施設`)
