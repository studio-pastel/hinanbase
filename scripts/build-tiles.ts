// 中間データ（改行区切り GeoJSON）から tippecanoe で PMTiles を生成する（SPEC §2.4、§5.6）
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { BUILD_DIR, FACILITIES_NDJSON } from './lib/paths.ts'
import { SUM_ATTRIBUTES } from './lib/tileProps.ts'

/** この値以上のズームでは全施設を個別の点として持つ。フロントの地図もこの値を参照する */
export const POINT_ZOOM = 12
export const MIN_ZOOM = 4

if (!existsSync(FACILITIES_NDJSON)) throw new Error('先に rescore を実行してください')
const outDir = join(BUILD_DIR, 'tiles')
mkdirSync(outDir, { recursive: true })
const out = join(outDir, 'shelters.pmtiles')

// まとめ表示（低ズーム）で合算する属性。件数を落とさないための設定：
//   -r1                      点を間引かない
//   -b0                      タイルの縁の重複をなくす（まとめ表示の件数が二重に数えられないように）
//   --cluster-distance       近い点を1つにまとめ、point_count に件数を持たせる
//   --cluster-maxzoom        POINT_ZOOM 未満だけでまとめる（POINT_ZOOM では全点が個別）
//   --no-feature-limit / --no-tile-size-limit  タイルが大きくても点を捨てない
const sums = SUM_ATTRIBUTES
const args = [
  '-o', out, '--force', '-l', 'shelters', '-P', '--quiet',
  `-Z${MIN_ZOOM}`, `-z${POINT_ZOOM}`, '-r1', '-b0',
  '--cluster-distance=26', `--cluster-maxzoom=${POINT_ZOOM - 1}`,
  ...sums.map((a) => `--accumulate-attribute=${a}:sum`),
  '--no-feature-limit', '--no-tile-size-limit',
  '--name=HinanBase shelters',
  '--attribution=国土地理院「指定緊急避難場所・指定避難所データ」',
  FACILITIES_NDJSON,
]
execFileSync('tippecanoe', args, { stdio: 'inherit' })
console.log(`生成: ${out}`)
