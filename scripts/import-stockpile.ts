// 備蓄の数を公的資料から取り込み、data/public/stockpile.json に書く（DATA_NOTES 18・19）。
// このファイルは Git に入れ、日次の再計算（rescore）が市区町村ファイル・施設に載せる。元の資料は data/raw/public/ に手作業で置く（Git 管理外）。
//
//   npm run data:stockpile
//
// 取り込むもの（承認：2026-11-24）
//   1. 内閣府「災害用物資・機材等の備蓄状況に関する調査結果（令和 6 年 11 月 1 日時点）」：市区町村ごとの数
//   2. 徳島県「避難所等の備蓄物資・資機材保管リスト（令和 8 年 4 月 1 日時点）」：指定避難所ごとの数
// 空欄は値を持たない（0 で埋めない）。施設に対応づけられない行は、施設に載せず report に残す。
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MuniFile, StockpileSource } from '../shared/types.ts'
import { muniNamesFromGeocode, normFacilityName, normKana, type MuniName } from './lib/publicAmenities.ts'
import { BUILD_DIR, RAW_DIR, ROOT } from './lib/paths.ts'
import { parseCaoPage, parseTokushimaPage } from './lib/stockpile.ts'

interface Def { key: string; group: string; label_ja: string; cao?: string; tokushima?: string }
const defs = (JSON.parse(readFileSync(join(ROOT, 'config', 'stockpile-defs.json'), 'utf8')) as { items: Def[] }).items

const RAW = join(RAW_DIR, 'public')
const OUT = join(ROOT, 'data', 'public', 'stockpile.json')
const SOURCES: Record<'cao' | 'tokushima', StockpileSource & { file: string }> = {
  cao: {
    file: 'cao_stockpile_20241101.pdf',
    title: '災害用物資・機材等の備蓄状況に関する調査結果（令和6年11月1日時点）',
    publisher: '内閣府（防災担当）',
    url: 'https://www.bousai.go.jp/taisaku/hinanjo/pdf/r6_1101.pdf',
    as_of: '2024-11-01',
    scope: 'muni',
    note: '市区町村が備蓄している数の合計。どの避難所に置かれているかは分からない。協定で調達できる分と、建物に備え付けの設備（エアコンなど）は含まない。空欄は資料に記載がないもの。静岡県焼津市の毛布・大人用紙おむつ・仮設トイレは、県が公表した訂正の値',
  },
  tokushima: {
    file: 'tokushima_stockpile_20260401',
    title: '避難所等の備蓄物資・資機材保管リスト（令和8年4月1日時点）',
    publisher: '徳島県・県内市町村',
    url: 'https://www.pref.tokushima.lg.jp/anshin/bousai/taisaku/sonota/7313032/',
    as_of: '2026-04-01',
    scope: 'facility',
    note: 'この避難所に置かれている数。空欄は資料に記載がないもの',
  },
}
for (const s of Object.values(SOURCES)) if (!existsSync(join(RAW, s.file))) throw new Error(`元の資料がありません: data/raw/public/${s.file}`)

const muniDir = join(BUILD_DIR, 'facilities', 'by-muni')
const munis = new Map<string, MuniFile>()
for (const f of readdirSync(muniDir)) munis.set(f.slice(0, 5), JSON.parse(readFileSync(join(muniDir, f), 'utf8')) as MuniFile)
const byPref = new Map<string, MuniName[]>()
for (const f of readdirSync(join(BUILD_DIR, 'geocode'))) {
  const g = JSON.parse(readFileSync(join(BUILD_DIR, 'geocode', f), 'utf8')) as { pref_name: string; munis: { code: string; name: string; key: string }[] }
  byPref.set(g.pref_name, muniNamesFromGeocode(g.munis))
}
const muniKey = (pref: string, name: string) => byPref.get(pref)?.find((m) => m.name === normKana(name))?.key || undefined
const report: Record<string, unknown> = {}

// 1. 内閣府の市区町村ごとの表
const muniValues: Record<string, Record<string, number>> = {}
const caoUnits: Record<string, string> = {}
{
  const pdf = join(RAW, SOURCES.cao.file)
  const n = Number(execFileSync('pdfinfo', [pdf]).toString().match(/Pages:\s+(\d+)/)![1])
  const problems: string[] = []
  const unmatched: string[] = []
  const dup: string[] = []
  let rows = 0
  let ratio: number | undefined
  let refColumns: { label: string; unit: string }[] = []
  const nameFix: Record<string, string> = { 睦沢町町: '睦沢町' } // 資料の誤記（千葉県）
  const sameDup: string[] = []
  for (let p = 1; p <= n; p++) {
    const page = parseCaoPage(execFileSync('pdftotext', ['-f', String(p), '-l', String(p), '-bbox', pdf, '-']).toString('utf8'), ratio)
    if (!page.pref) continue // 都道府県の一覧のページ
    ratio = page.rightRatio ?? ratio
    problems.push(...page.problems.map((s) => `${p} ページ：${s}`))
    // 列の名前（NFKC）→ 項目
    // 見出しの語が読めない列（例：神奈川県のページの「携帯トイレ」）は、最初のページの同じ位置の列の名前を、単位が同じときだけ使う
    if (!refColumns.length) refColumns = page.columns
    const colOf = new Map<string, number>()
    page.columns.forEach((c, i) => {
      const ref = refColumns[i]
      const label = c.label || (ref && ref.unit === c.unit && page.columns.length === refColumns.length ? ref.label : '')
      if (!c.label && label) problems.push(`${page.pref} ${p} ページ：見出しが読めない列 ${i + 1} を「${label}」とした（単位 ${c.unit}）`)
      if (label) colOf.set(label.normalize('NFKC'), i)
    })
    for (const d of defs) {
      if (!d.cao) continue
      const i = colOf.get(d.cao.normalize('NFKC'))
      if (i === undefined) { problems.push(`${page.pref} ${p} ページ：列「${d.cao}」がない`); continue }
      const unit = page.columns[i]!.unit
      if (!caoUnits[d.key]) caoUnits[d.key] = unit
      else if (caoUnits[d.key] !== unit) problems.push(`${d.key}: 単位がページで違う（${caoUnits[d.key]} / ${unit}）`)
    }
    for (const r of page.rows) {
      if (/計$|備蓄分$/.test(r.name)) continue // 都道府県の合計と、都道府県が備蓄している分
      rows++
      const name = nameFix[r.name] ?? r.name
      const key = muniKey(r.pref, name)
      if (!key || !munis.has(key)) { unmatched.push(`${r.pref}${r.name}`); continue }
      const v: Record<string, number> = {}
      for (const d of defs) {
        if (!d.cao) continue
        const i = colOf.get(d.cao.normalize('NFKC'))
        if (i !== undefined && r.values[i] !== undefined) v[d.key] = r.values[i]!
      }
      if (muniValues[key]) {
        if (JSON.stringify(muniValues[key]) === JSON.stringify(v)) sameDup.push(`${r.pref}${r.name}`)
        else dup.push(`${r.pref}${r.name}`)
        continue
      }
      muniValues[key] = v
    }
  }
  // 都道府県が公表した訂正（DATA_NOTES 20）。訂正前の値（空欄）と一致するときだけ直し、report に残す
  //   静岡県「令和7年1月9日内閣府公表の…県内分調査結果の訂正について」（2025-01-22）：焼津市の 3 品目が空欄になっていた
  //   https://www.pref.shizuoka.jp/bosaikinkyu/sonae/1040803/1068848.html
  const corrections: { key: string; name: string; item: string; before: number | null; after: number }[] = [
    { key: '22212', name: '静岡県焼津市', item: 'blanket', before: null, after: 14288 },
    { key: '22212', name: '静岡県焼津市', item: 'diaper_adult', before: null, after: 670 },
    { key: '22212', name: '静岡県焼津市', item: 'toilet_temporary', before: null, after: 284 },
  ]
  const applied: string[] = []
  for (const c of corrections) {
    const v = muniValues[c.key]
    if (!v) { problems.push(`訂正：${c.name} の行がない`); continue }
    if ((v[c.item] ?? null) !== c.before) { problems.push(`訂正：${c.name} ${c.item} が訂正前の値（${c.before ?? '空欄'}）と違う（${v[c.item]}）`); continue }
    v[c.item] = c.after
    applied.push(`${c.name} ${c.item}: ${c.before ?? '空欄'} → ${c.after}`)
  }
  report.cao = { rows, munis: Object.keys(muniValues).length, unmatched, duplicated_same_values: sameDup, duplicated_different_values: dup, corrections: applied, problems }
}

// 2. 徳島県の避難所ごとの表
interface FacilityEntry { list_name: string; list_capacity: number | null; values: Record<string, number | string> }
const facilityValues: Record<string, FacilityEntry[]> = {}
const tkUnits: Record<string, string> = {}
{
  const dir = join(RAW, SOURCES.tokushima.file)
  const problems: string[] = []
  const unmatchedCols = new Set<string>()
  const kinds: Record<string, number> = {}
  const unmatchedRows: string[] = []
  let shelterRows = 0, matched = 0
  const matchers = defs.filter((d) => d.tokushima).map((d) => ({ d, re: new RegExp(d.tokushima!) }))
  for (const file of readdirSync(dir).filter((f) => /^\d\d_.+\.pdf$/.test(f) && !f.startsWith('00_')).sort()) {
    const pdf = join(dir, file)
    const n = Number(execFileSync('pdfinfo', [pdf]).toString().match(/Pages:\s+(\d+)/)![1])
    const rows: ReturnType<typeof parseTokushimaPage>['rows'] = []
    for (let p = 1; p <= n; p++) {
      const page = parseTokushimaPage(execFileSync('pdftotext', ['-f', String(p), '-l', String(p), '-bbox', pdf, '-']).toString('utf8'))
      problems.push(...page.problems.map((s) => `${file}: ${s}`))
      for (const c of page.columns) {
        const label = c.label.normalize('NFKC')
        const m = matchers.find(({ re }) => re.test(label))
        if (!m) { unmatchedCols.add(label); continue }
        const unit = c.unit === '〇/✕' ? '' : c.unit
        if (tkUnits[m.d.key] === undefined) tkUnits[m.d.key] = unit
      }
      rows.push(...page.rows)
    }
    for (const r of rows) kinds[r.kind] = (kinds[r.kind] ?? 0) + 1
    const shelters = rows.filter((r) => r.kind === '指定避難所')
    shelterRows += shelters.length
    const muni = shelters.find((r) => r.muni)?.muni ?? file.replace(/^\d\d_|\.pdf$/g, '')
    const key = muni ? muniKey('徳島県', muni) : undefined
    const mf = key ? munis.get(key) : undefined
    if (!mf) { unmatchedRows.push(`${file}: 市町村が施設データにない`); continue }
    // 名前で対応づける。一覧の名前・施設の名前のどちらかに「体育館」などの建物名が付く場合は、外した名前でも試す（指定避難所で 1 件に決まるときだけ）
    const strip = (n: string) => normFacilityName(n).replace(/(体育館|屋内運動場|講堂|校舎|本館|アリーナ)$/, '')
    const exact = new Map<string, typeof mf.facilities>()
    const loose = new Map<string, typeof mf.facilities>()
    for (const f of mf.facilities.filter((f) => f.designations.shelter.length > 0)) {
      exact.set(normFacilityName(f.name), [...(exact.get(normFacilityName(f.name)) ?? []), f])
      loose.set(strip(f.name), [...(loose.get(strip(f.name)) ?? []), f])
    }
    for (const r of shelters) {
      // 折り返しで閉じ括弧が欠けた名前（「○○（第一体育」）は、括弧の前まででも試す
      const cands = [normFacilityName(r.name), normFacilityName(r.name.split(' ')[0]!), normFacilityName(r.name.replace(/[（(][^）)]*$/, ''))]
      let hits = cands.map((c) => exact.get(c) ?? []).find((h) => h.length > 0) ?? []
      if (hits.length === 0) hits = [strip(r.name), strip(r.name.split(' ')[0]!)].map((c) => loose.get(c) ?? []).find((h) => h.length > 0) ?? []
      const f = hits.length === 1 ? hits[0] : undefined
      if (!f) { unmatchedRows.push(`${mf.muni_name} ${r.name}${hits.length > 1 ? '（候補が複数）' : ''}`); continue }
      const values: Record<string, number | string> = {}
      for (const [label, v] of Object.entries(r.values)) {
        const m = matchers.find(({ re }) => re.test(label.replace(/（[^（]*）$/, '').normalize('NFKC')))
        if (m) values[m.d.key] = v
      }
      ;(facilityValues[f.id] ??= []).push({ list_name: r.name, list_capacity: r.capacity, values })
      matched++
    }
  }
  report.tokushima = { kinds, shelter_rows: shelterRows, matched_rows: matched, facilities: Object.keys(facilityValues).length, unmatched_rows: unmatchedRows, unmatched_columns: [...unmatchedCols], problems }
}

const sources = Object.fromEntries(Object.entries(SOURCES).map(([k, s]) => [k, { ...s, units: k === 'cao' ? caoUnits : tkUnits }]))
mkdirSync(join(ROOT, 'data', 'public'), { recursive: true })
writeFileSync(OUT, JSON.stringify({
  generated_by: 'scripts/import-stockpile.ts',
  note: '公的資料から取り込んだ備蓄の数（DATA_NOTES 18・19）。空欄は値を持たない（0 で埋めない）',
  sources,
  munis: Object.fromEntries(Object.entries(muniValues).sort(([a], [b]) => a.localeCompare(b))),
  facilities: Object.fromEntries(Object.entries(facilityValues).sort(([a], [b]) => a.localeCompare(b))),
  report,
}, null, 1) + '\n')
console.log(JSON.stringify(report, (_k, v) => (Array.isArray(v) && v.length > 8 ? [`${v.length} 件`, ...v.slice(0, 8)] : v), 1))
