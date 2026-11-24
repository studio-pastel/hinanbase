// 都道府県がまとめて公表した「県内市町村の備蓄の数」（災害対策基本法第 49 条第 2 項による毎年の公表）を取り込み、
// data/public/stockpile-yearly.json に書く（DATA_NOTES 20）。日次の再計算（rescore）が市区町村ファイルに載せ、
// 画面は内閣府の調査（令和 6 年 11 月 1 日時点、stockpile.json）と並べて変化を出す。
//
//   npm run data:stockpile-yearly
//
// 元の資料は data/raw/public/pref_stockpile/ に手作業で置く（Git 管理外）。
// 比べるのは、品目名が内閣府の調査と同じ（config/stockpile-defs.json の cao か muni の別名）で、単位も同じ列だけ。
// 空欄・「-」は値を持たない。資料に「0」と書いてあるものだけ 0 とする。
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { StockpileSource } from '../shared/types.ts'
import { muniNamesFromGeocode, normKana, type MuniName } from './lib/publicAmenities.ts'
import { BUILD_DIR, RAW_DIR, ROOT } from './lib/paths.ts'
import { mapColumns, sheetGrid, tableFromPdfPage, tableFromSheet, type ItemDef, type Table } from './lib/muni-stockpile.ts'

const defs = (JSON.parse(readFileSync(join(ROOT, 'config', 'stockpile-defs.json'), 'utf8')) as { items: ItemDef[] }).items.filter((d) => d.cao)
const base = JSON.parse(readFileSync(join(ROOT, 'data', 'public', 'stockpile.json'), 'utf8')) as { sources: { cao: { units: Record<string, string> } } }
const caoUnits = base.sources.cao.units

const RAW = join(RAW_DIR, 'public', 'pref_stockpile')
const OUT = join(ROOT, 'data', 'public', 'stockpile-yearly.json')

interface Src extends StockpileSource { file: string; pref: string; page: string }
const NOTE = '県が県内の市町村の数をまとめて公表したもの。市町村が備蓄している数の合計で、どの避難所に置かれているかは分からない。空欄は資料に記載がないもの'
const SOURCES: Record<string, Src> = {
  iwate: { pref: '岩手県', file: '03_iwate_2026.xlsx', title: '県及び市町村の災害対策用物資の備蓄状況（令和8年7月1日時点）全体版', publisher: '岩手県', url: 'https://www.pref.iwate.jp/_res/projects/default_project/_page_/001/096/965/r8zentai.xlsx', page: 'https://www.pref.iwate.jp/kurashikankyou/anzenanshin/bosai/1096965/index.html', as_of: '2026-07-01', scope: 'muni', note: NOTE },
  saitama: { pref: '埼玉県', file: '11_saitama_20260701.pdf', title: '県市町村備蓄状況の公表（令和8年分、令和8年7月1日時点）', publisher: '埼玉県', url: 'https://www.pref.saitama.lg.jp/documents/26237/080901-00001.pdf', page: 'https://www.pref.saitama.lg.jp/a0402/bichiku.html', as_of: '2026-07-01', scope: 'muni', note: NOTE },
  chiba: { pref: '千葉県', file: '12_chiba_20260630.xlsx', title: '県内備蓄状況の公表（令和8年分、令和8年6月30日時点）', publisher: '千葉県', url: 'https://www.pref.chiba.lg.jp/bousai/saigaitaisaku/documents/r8-chibabichiku.xlsx', page: 'https://www.pref.chiba.lg.jp/bousai/saigaitaisaku/bichiku.html', as_of: '2026-06-30', scope: 'muni', note: NOTE },
  shizuoka: { pref: '静岡県', file: '22_shizuoka_20251201.pdf', title: '防災に必要な物資等の備蓄状況調査結果（令和7年12月1日時点）', publisher: '静岡県', url: 'https://www.pref.shizuoka.jp/_res/projects/default_project/_page_/001/079/308/261201bichiku.pdf', page: 'https://www.pref.shizuoka.jp/bosaikinkyu/sonae/1040803/1079308.html', as_of: '2025-12-01', scope: 'muni', note: NOTE },
  mie: { pref: '三重県', file: '24_mie_20260401.pdf', title: '県及び市町の公的備蓄物資の備蓄量（令和8年4月1日時点）', publisher: '三重県', url: 'https://www.pref.mie.lg.jp/common/content/001247244.pdf', page: 'https://www.pref.mie.lg.jp/STAISAKU/HP/m0099500153.htm', as_of: '2026-04-01', scope: 'muni', note: NOTE },
  kochi: { pref: '高知県', file: '39_kochi_20250401.pdf', title: '県及び市町村の公的備蓄物資の備蓄量【50品目】（令和7年4月1日時点）', publisher: '高知県', url: 'https://www.pref.kochi.lg.jp/doc/2025110500064/file_contents/file_202511182133859_1.pdf', page: 'https://www.pref.kochi.lg.jp/doc/2025110500064/', as_of: '2025-04-01', scope: 'muni', note: NOTE },
  miyazaki: { pref: '宮崎県', file: '45_miyazaki_20260331.pdf', title: '県及び市町村の災害時用備蓄物資（令和8年3月31日時点）', publisher: '宮崎県', url: 'http://www.pref.miyazaki.lg.jp/documents/110111/110111_20260619171430-1.pdf', page: 'http://www.pref.miyazaki.lg.jp/kiki-kikikanri/bosai/keikaku/20260617164141.html', as_of: '2026-03-31', scope: 'muni', note: NOTE },
}
for (const s of Object.values(SOURCES)) if (!existsSync(join(RAW, s.file))) throw new Error(`元の資料がありません: data/raw/public/pref_stockpile/${s.file}`)

const muniDir = join(BUILD_DIR, 'facilities', 'by-muni')
const munis = new Set(readdirSync(muniDir).map((f) => f.slice(0, 5)))
const byPref = new Map<string, MuniName[]>()
for (const f of readdirSync(join(BUILD_DIR, 'geocode'))) {
  const g = JSON.parse(readFileSync(join(BUILD_DIR, 'geocode', f), 'utf8')) as { pref_name: string; munis: { code: string; name: string; key: string }[] }
  byPref.set(g.pref_name, muniNamesFromGeocode(g.munis))
}
const muniKey = (pref: string, name: string) => byPref.get(pref)?.find((m) => m.name === normKana(name))?.key || undefined
/** 市区町村ではない行（県の備蓄分・合計） */
const NOT_MUNI = /計$|備蓄分$|^(岩手県|埼玉県|千葉県|静岡県|三重県|高知県|宮崎県)$/

function readTables(file: string): Table[] {
  const p = join(RAW, file)
  if (file.endsWith('.xlsx')) {
    let shared: string | null = null
    try { shared = execFileSync('unzip', ['-p', p, 'xl/sharedStrings.xml'], { maxBuffer: 1e8 }).toString('utf8') } catch { /* 共有文字列がないブック */ }
    return [tableFromSheet(sheetGrid(execFileSync('unzip', ['-p', p, 'xl/worksheets/sheet1.xml'], { maxBuffer: 1e8 }).toString('utf8'), shared))]
  }
  const n = Number(execFileSync('pdfinfo', [p]).toString().match(/Pages:\s+(\d+)/)![1])
  const out: Table[] = []
  let prev: ReturnType<typeof tableFromPdfPage> | undefined
  for (let i = 1; i <= n; i++) {
    const t = tableFromPdfPage(execFileSync('pdftotext', ['-f', String(i), '-l', String(i), '-bbox', p, '-']).toString('utf8'), prev)
    if (t.columns.length) prev = t
    out.push(t)
  }
  return out
}

const values: Record<string, Record<string, Record<string, number>>> = {} // muni → source → item → 数
const report: Record<string, unknown> = {}
for (const [id, s] of Object.entries(SOURCES)) {
  const problems: string[] = []
  const unmatched: string[] = []
  const items = new Set<string>()
  let rows = 0
  readTables(s.file).forEach((t, page) => {
    problems.push(...t.problems.map((x) => `${page + 1} ページ：${x}`))
    const { map, problems: mp } = mapColumns(t.columns, defs, caoUnits)
    problems.push(...mp.map((x) => `${page + 1} ページ：${x}`))
    for (const k of map.keys()) items.add(k)
    for (const r of t.rows) {
      if (NOT_MUNI.test(r.name)) continue
      const key = r.code ? r.code.slice(0, 5) : muniKey(s.pref, r.name)
      if (!key || !munis.has(key)) { if (page === 0) unmatched.push(r.name); continue }
      if (page === 0) rows++
      const v = ((values[key] ??= {})[id] ??= {})
      for (const [item, col] of map) {
        const n = r.values[col]
        if (n === undefined) continue
        if (v[item] !== undefined && v[item] !== n) problems.push(`${r.name} ${item}: ページで数が違う（${v[item]} / ${n}）`)
        v[item] = n
      }
    }
  })
  report[id] = { munis: rows, items: [...items].sort(), unmatched, problems }
}

const units = Object.fromEntries(defs.map((d) => [d.key, caoUnits[d.key]]).filter(([, u]) => u))
writeFileSync(OUT, JSON.stringify({
  generated_by: 'scripts/import-stockpile-yearly.ts',
  note: '都道府県がまとめて公表した、市区町村ごとの備蓄の数（DATA_NOTES 20）。品目名と単位が内閣府の調査（令和6年11月1日時点）と同じ列だけ。空欄は値を持たない（0 で埋めない）。単位は内閣府の調査の単位（台・基・棟は同じ数え方として扱う）',
  sources: Object.fromEntries(Object.entries(SOURCES).map(([k, s]) => { const { pref, ...rest } = s; void pref; return [k, { ...rest, units }] })),
  munis: Object.fromEntries(Object.entries(values).sort(([a], [b]) => a.localeCompare(b))),
  report,
}, null, 1) + '\n')
console.log(JSON.stringify(report, (_k, v) => (Array.isArray(v) && v.length > 10 ? [`${v.length} 件`, ...v.slice(0, 10)] : v), 1))
