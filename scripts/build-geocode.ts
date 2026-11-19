// 住所照合用のファイル（geocode/{都道府県コード}.json）を作る（SPEC §6.6、DATA_NOTES 13 章）。
// 元データは国土交通省「位置参照情報」大字・町丁目レベル。都道府県ごとの zip を data/raw/isj/{取得日}/ に手動で置く。
//   npm run data:geocode
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { GeocodeFile } from '../shared/geocode.ts'
import type { MuniIndexFile } from '../shared/types.ts'
import { BUILD_DIR, RAW_DIR } from './lib/paths.ts'
import { parseCsv } from './lib/capacity.ts'

const root = join(RAW_DIR, 'isj')
const date = existsSync(root) ? readdirSync(root).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().at(-1) : undefined
if (!date) throw new Error('data/raw/isj/ に取得日（YYYY-MM-DD）のフォルダがありません')
const dir = join(root, date)
const index = JSON.parse(readFileSync(join(BUILD_DIR, 'summary', 'munis.json'), 'utf8')) as MuniIndexFile
const outDir = join(BUILD_DIR, 'geocode')
mkdirSync(outDir, { recursive: true })

// 本サービスの市区町村コード。政令指定都市の区は、市の名前で市のコードに対応づける
const keyByName = new Map<string, string>()
const keys = new Set<string>()
for (const p of index.prefs) for (const m of p.munis) {
  keys.add(m.key)
  keyByName.set(`${p.code}:${m.name.startsWith(p.name) ? m.name.slice(p.name.length) : m.name}`, m.key)
}
const muniKey = (pref: string, code: string, name: string): string | null => {
  if (keys.has(code)) return code
  const city = name.match(/^(.+?市).+区$/)?.[1]
  return city ? keyByName.get(`${pref}:${city}`) ?? null : keyByName.get(`${pref}:${name}`) ?? null
}

let total = 0
let noKey = 0
for (const zip of readdirSync(dir).filter((f) => /^\d{2}000-[\d.]+b\.zip$/.test(f)).sort()) {
  const csvName = execFileSync('unzip', ['-Z1', zip], { cwd: dir }).toString().split('\n').find((n) => n.endsWith('.csv'))!
  const text = new TextDecoder('shift_jis').decode(execFileSync('unzip', ['-p', zip, csvName], { cwd: dir, maxBuffer: 2 ** 28 }))
  const [header, ...rows] = parseCsv(text)
  const col = (n: string) => header!.indexOf(n)
  const c = { pc: col('都道府県コード'), pn: col('都道府県名'), mc: col('市区町村コード'), mn: col('市区町村名'), tn: col('大字町丁目名'), lat: col('緯度'), lng: col('経度'), kind: col('大字・字・丁目区分コード') }
  if (Object.values(c).some((i) => i < 0)) throw new Error(`${zip}: 想定した列がありません`)
  const pref = rows[0]![c.pc]!.padStart(2, '0')
  const file: GeocodeFile = {
    pref_code: pref, pref_name: rows[0]![c.pn]!,
    source: `「位置参照情報ダウンロードサービス」（国土交通省）大字・町丁目レベル（${zip.replace(/^\d+-|\.zip$/g, '')}）を加工して作成`,
    munis: [], towns: [],
  }
  const muniIdx = new Map<string, number>()
  for (const r of rows) {
    const code = r[c.mc]!.padStart(5, '0')
    let i = muniIdx.get(code)
    if (i === undefined) {
      const key = muniKey(pref, code, r[c.mn]!)
      if (!key) noKey++
      i = file.munis.push({ code, name: r[c.mn]!, key }) - 1
      muniIdx.set(code, i)
    }
    const lat = Number(r[c.lat]); const lng = Number(r[c.lng])
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    file.towns.push([i, r[c.tn]!, Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5, Number(r[c.kind])])
  }
  writeFileSync(join(outDir, `${pref}.json`), JSON.stringify(file))
  total += file.towns.length
}
console.log(`住所照合用ファイル: 町丁目 ${total} 件（市区町村コードを対応づけられなかった市区町村 ${noKey}）`)
