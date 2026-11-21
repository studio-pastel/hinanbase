// 照会先の候補を作る（DATA_NOTES 17）。市区町村ごとに、災害救助法の適用のあった年の数・避難所の地点の気温の平年値・
// 高齢化率・ハザード・分かっている設備の不足を並べ、承認された条件で照会先を絞る。
// 画面で自治体を順位付けして見せるためのものではない（照会の順番を決める内部の道具）。
//
//   npm run data:inquiry-targets
//
// 元の資料は data/raw/inquiry/ に置く（Git 管理外。DATA_NOTES 17.2）
//   relief-groups.json  内閣府「災害救助法の適用状況」のページの、災害ごとの PDF の一覧（題名 → PDF のパス）
//   relief/*.pdf        その PDF
//   g02/*.zip           国土数値情報「平年値メッシュ」2022 年度版（非商用）
//   juki-age-*.xlsx     総務省「住民基本台帳年齢階級別人口（市区町村別）」
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MuniFile, MuniIndexFile } from '../shared/types.ts'
import { BUILD_DIR, RAW_DIR, ROOT } from './lib/paths.ts'

const RAW = join(RAW_DIR, 'inquiry')
const OUT_DIR = join(ROOT, 'data', 'inquiry')

/** 承認された条件（2026-11-21、DATA_NOTES 17.3・17.5）。暖房を優先：寒く、災害が繰り返され、高齢者が多い */
export const CONDITION = { relief_years_min: 2, jan_min_max: -3, r80_min: 12 }

const norm = (s: string) => s.normalize('NFKC').replace(/[ヶヵケ]/g, 'ケ')
const stripGun = (n: string) => (/[町村]$/.test(n) ? n.replace(/^.+?郡(?=.+[町村]$)/, '') : n)

// 市区町村名 → キー（住所照合用データ。政令指定都市の区は市にまとめる）
const geo = new Map<string, Map<string, string>>()
for (const f of readdirSync(join(BUILD_DIR, 'geocode'))) {
  const g = JSON.parse(readFileSync(join(BUILD_DIR, 'geocode', f), 'utf8')) as { pref_name: string; munis: { code: string; name: string; key: string | null }[] }
  const m = new Map<string, string>()
  for (const x of g.munis) {
    const name = x.key && x.code !== x.key ? x.name.replace(/^(.+?市).+区$/, '$1') : x.name
    m.set(norm(stripGun(name)), x.key ?? `nokey:${x.code}`)
  }
  geo.set(g.pref_name, m)
}
const prefNames = [...geo.keys()]

// 1. 災害救助法の適用のあった年
const toYear = (t: string): number | null => {
  const z = t.normalize('NFKC')
  let m = z.match(/令和(元|\d+)年/)
  if (m) return 2018 + (m[1] === '元' ? 1 : Number(m[1]))
  m = z.match(/平成(元|\d+)年/)
  if (m) return 1988 + (m[1] === '元' ? 1 : Number(m[1]))
  return null
}
const pdfText = (href: string): string | null => {
  const pdf = join(RAW, 'relief', href.split('/').pop()!)
  if (!existsSync(pdf)) return null
  try { return execFileSync('pdftotext', ['-layout', pdf, '-']).toString('utf8') } catch { return null }
}
const groups = JSON.parse(readFileSync(join(RAW, 'relief-groups.json'), 'utf8')) as Record<string, string[]>
const reportNo = (h: string) => Number(h.match(/(\d+)\.pdf$/)?.[1] ?? 0)
const reliefYears = new Map<string, Set<number>>()
const reliefLog = { disasters: 0, skipped_pre_disaster: 0, no_year: [] as string[], unreadable: [] as string[] }
for (const [title, hrefs] of Object.entries(groups)) {
  if (/救助終了|適用状況（平成/.test(title)) continue // 年度のまとめ・救助終了の公示は二重に数えないため除く
  if (/第[2２]条第[2２]項/.test(title)) { reliefLog.skipped_pre_disaster++; continue } // 災害が起きる前の適用
  const last = hrefs.reduce((a, b) => (reportNo(b) > reportNo(a) ? b : a), hrefs[0]!) // 最終報（訂正を反映）
  const raw = pdfText(last)
  if (raw === null) { reliefLog.unreadable.push(title); continue }
  const year = toYear(title) ?? toYear(raw.replace(/\s+/g, ''))
  if (year === null) { reliefLog.no_year.push(title); continue }
  reliefLog.disasters++
  const txt = norm(raw.split(/○?留意事項/)[0]!) // 留意事項の欄は別の災害の再掲なので除く
  const body = txt.slice(Math.max(0, txt.indexOf('適用市町村'))).replace(/[(（][ぁ-ゖー\s]*[)）]/g, ' ').replace(/[ \t]+/g, '')
  const pos: [number, string][] = []
  for (const p of prefNames) for (const m of body.matchAll(new RegExp(p, 'g'))) pos.push([m.index!, p])
  pos.sort((a, b) => a[0] - b[0])
  for (const [j, [at, pref]] of pos.entries()) {
    let seg = body.slice(at + pref.length, pos[j + 1]?.[0] ?? body.length)
    for (const [n, k] of [...geo.get(pref)!].sort((a, b) => b[0].length - a[0].length)) {
      if (n.length < 2 || !seg.includes(n)) continue
      reliefYears.set(k, (reliefYears.get(k) ?? new Set()).add(year))
      seg = seg.split(n).join('□')
    }
  }
}

// 2. 気温の平年値（指定避難所の地点の 3 次メッシュ。0.1℃）
const mesh = new Map<string, [number, number]>()
for (const z of readdirSync(join(RAW, 'g02')).filter((f) => f.endsWith('.zip'))) {
  const gj = JSON.parse(execFileSync('unzip', ['-p', join(RAW, 'g02', z), '*.geojson'], { maxBuffer: 2 ** 30 }).toString()) as { features: { properties: Record<string, number | string> }[] }
  for (const f of gj.features) mesh.set(String(f.properties.G02_001), [Number(f.properties.G02_016), Number(f.properties.G02_036)])
}
const mesh3 = (lat: number, lng: number) => {
  const a = lat * 1.5, b = lng - 100
  const p = Math.floor(a), u = Math.floor(b)
  const q = Math.floor((a - p) * 8), v = Math.floor((b - u) * 8)
  const r = Math.floor(((a - p) * 8 - q) * 10), w = Math.floor(((b - u) * 8 - v) * 10)
  return `${p}${u}${q}${v}${r}${w}`
}

// 3. 高齢化率（65 歳以上・80 歳以上の割合）
const age = new Map<string, { r65: number; r80: number }>()
{
  const xlsx = join(RAW, readdirSync(RAW).find((f) => /^juki-age-.*\.xlsx$/.test(f))!)
  const unz = (p: string) => execFileSync('unzip', ['-p', xlsx, p], { maxBuffer: 2 ** 30 }).toString('utf8')
  const ss = [...unz('xl/sharedStrings.xml').replace(/<rPh.*?<\/rPh>/gs, '').matchAll(/<si>(.*?)<\/si>/gs)].map((m) => m[1]!.replace(/<[^>]+>/g, ''))
  for (const row of unz('xl/worksheets/sheet1.xml').matchAll(/<row[^>]*>(.*?)<\/row>/gs)) {
    const c: Record<string, string> = {}
    for (const m of row[1]!.matchAll(/<c r="([A-Z]+)\d+"([^>]*)>(?:<v>([^<]*)<\/v>)?/g)) c[m[1]!] = m[3] !== undefined && m[2]!.includes('t="s"') ? ss[Number(m[3])]! : m[3] ?? ''
    if (c.D !== '計' || !/^\d{6}$/.test(c.A ?? '')) continue
    const tot = Number(c.E)
    if (!tot) continue
    const sum = (cols: string) => [...cols].reduce((s, k) => s + Number(c[k] || 0), 0)
    age.set(c.A!.slice(0, 5), { r65: Math.round((sum('STUVWXYZ') / tot) * 1000) / 10, r80: Math.round((sum('VWXYZ') / tot) * 1000) / 10 })
  }
}

// 4. 市区町村ごとの表
const pub = existsSync(join(ROOT, 'data', 'public', 'amenities.json'))
  ? (JSON.parse(readFileSync(join(ROOT, 'data', 'public', 'amenities.json'), 'utf8')) as { values: Record<string, Record<string, { value: unknown }>> }).values
  : {}
const idx = JSON.parse(readFileSync(join(BUILD_DIR, 'summary', 'munis.json'), 'utf8')) as MuniIndexFile
const median = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]! : null)
const rows = idx.prefs.flatMap((p) => p.munis.map((m) => {
  const muni = JSON.parse(readFileSync(join(BUILD_DIR, 'facilities', 'by-muni', `${m.key}.json`), 'utf8')) as MuniFile
  const shel = muni.facilities.filter((f) => f.designations.shelter.length > 0)
  const temps = shel.map((f) => mesh.get(mesh3(f.lat, f.lng))).filter((t): t is [number, number] => !!t)
  const years = [...(reliefYears.get(m.key) ?? [])].sort()
  return {
    key: m.key, pref: p.name, name: m.name, shelters: shel.length, deep3: m.deep3 ?? 0, landslide: m.landslide ?? 0,
    relief_years: years.length, relief_list: years.join(' '),
    jan_min: median(temps.map((t) => t[0] / 10)), aug_max: median(temps.map((t) => t[1] / 10)),
    r65: age.get(m.key)?.r65 ?? null, r80: age.get(m.key)?.r80 ?? null,
    aircon_none: shel.filter((f) => pub[f.id]?.aircon_main_hall?.value === 'none').length,
  }
}))
const C = CONDITION
const targets = rows
  .filter((r) => r.relief_years >= C.relief_years_min && r.jan_min !== null && r.jan_min <= C.jan_min_max && r.r80 !== null && r.r80 >= C.r80_min)
  .sort((a, b) => a.pref.localeCompare(b.pref) || a.key.localeCompare(b.key)) // 並びは都道府県・コード順（順位にしない）

mkdirSync(OUT_DIR, { recursive: true })
const csv = (rs: typeof rows) => {
  const h = Object.keys(rows[0]!) as (keyof (typeof rows)[number])[]
  return '﻿' + [h.join(','), ...rs.map((r) => h.map((k) => r[k] ?? '').join(','))].join('\n') + '\n'
}
writeFileSync(join(OUT_DIR, 'targets.csv'), csv(targets))
writeFileSync(join(BUILD_DIR, 'intermediate', 'inquiry-risk-table.csv'), csv(rows))
writeFileSync(join(OUT_DIR, 'targets.json'), JSON.stringify({
  generated_by: 'scripts/build-inquiry-targets.ts',
  note: '照会先の候補（DATA_NOTES 17）。照会の順番を決める内部の資料で、自治体の順位ではない。並びは都道府県・コード順',
  condition: C,
  sources: {
    relief: '内閣府「災害救助法の適用状況」 https://www.bousai.go.jp/taisaku/kyuujo/kyuujo_tekiyou.html （2014 年度〜。災害が起きる前の適用は除く）',
    climate: '国土数値情報「平年値メッシュ」2022 年度版（気象庁 メッシュ平年値2020）を加工して作成。非商用',
    age: '総務省「住民基本台帳年齢階級別人口（市区町村別）」',
  },
  relief_log: reliefLog,
  targets,
}, null, 1) + '\n')
console.log(JSON.stringify({ ...reliefLog, no_year: reliefLog.no_year.length, unreadable: reliefLog.unreadable.length, munis: rows.length, targets: targets.length, target_shelters: targets.reduce((s, r) => s + r.shelters, 0) }))
