// 公的資料から施設ごとの設備の値を作り、data/public/amenities.json に書く（DATA_NOTES 16.4・16.6）。
// このファイルは Git に入れ、日次の再計算（rescore）が読む。元の資料は data/raw/public/ に手作業で置く（Git 管理外）。
//
//   npm run data:public-amenities
//
// 取り込むもの（承認：2026-11-21）
//   1. 文部科学省の体育館等の冷房設置率（市区町村別）が 0% か 100% の市区町村の、市区町村立の小中学校（指定避難所）
//      → 主要な滞在スペースを体育館とみなし、冷房「なし」「あり（範囲は未確認）」
//   2. 自治体の設置一覧に載っている施設 → 「あり」。載っていない施設は未確認のまま
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AmenitySource, MuniFile } from '../shared/types.ts'
import { isMunicipalSchoolShelter, matchListNames, muniNamesFromGeocode, parseMextRates, type MuniName } from './lib/publicAmenities.ts'
import { BUILD_DIR, RAW_DIR, ROOT } from './lib/paths.ts'

const RAW = join(RAW_DIR, 'public')
const OUT_DIR = join(ROOT, 'data', 'public')
const OUT = join(OUT_DIR, 'amenities.json')
const muniDir = join(BUILD_DIR, 'facilities', 'by-muni')

const SOURCES = {
  mext_gym_aircon: {
    file: 'mext_gym_aircon_muni_20260501.pdf',
    title: '空調（冷房）設備設置状況（小中学校・体育館等）市区町村別',
    publisher: '文部科学省',
    url: 'https://www.mext.go.jp/content/20260730-mxt_sisetujo-000013462_17.pdf',
    as_of: '2026-05-01',
  },
  fukuoka_gym_aircon: {
    file: 'fukuoka_gym_aircon_20260701.pdf',
    title: '体育館の空調機設置校一覧（令和8年7月時点）',
    publisher: '福岡市教育委員会',
    url: 'https://www.city.fukuoka.lg.jp/kyoiku-iinkai/k-kankyou/BoardofEducationSecretariatHomepage/gakkoukaihou/documents/20260701_kuchosettikou.pdf',
    as_of: '2026-07-01',
  },
  sendai_solar_battery: {
    file: 'sendai_solar_battery.pdf',
    title: '仙台市内防災対応型太陽光発電システム導入小中学校等一覧',
    publisher: '仙台市',
    url: 'https://www.city.sendai.jp/kankyo/kurashi/machi/machizukuri/energy/hinanzyopv/documents/itiran.pdf',
    as_of: '2026-11-20',
  },
  chiba_solar_battery: {
    file: 'chiba_solar_battery.xlsx',
    title: '避難所への再生可能エネルギー等導入事業 導入施設一覧',
    publisher: '千葉市',
    url: 'https://www.city.chiba.jp/kankyo/kankyohozen/datsutanso/documents/ichiran.xlsx',
    as_of: '2026-11-20',
  },
  sapporo_gym_heating: {
    file: 'sapporo_gym_heating_2012.pdf',
    title: '第4回札幌市避難場所基本計画検討委員会 資料（第3章 寒さ対策・停電対策「基幹避難所（市立小中学校体育館）の暖房の現状」）',
    publisher: '札幌市',
    url: 'https://www.city.sapporo.jp/kikikanri/torikumi/hinanbasho_keikaku/documents/siryou04.pdf',
    as_of: '2012-11-28',
  },
  setagaya_gym_aircon: {
    file: 'setagaya_gym_aircon_plan_2018.pdf',
    title: '区立小中学校体育館への空調設備の設置について（冷暖房機能を持つ機器を全 90 校に設置）',
    publisher: '世田谷区',
    url: 'https://www.city.setagaya.lg.jp/documents/5560/1811017-1.pdf',
    as_of: '2018-11-01',
  },
  machida_gym_aircon: {
    file: 'machida_gym_aircon_report_2022.pdf',
    title: '体育館空調の設置効果について（報告）（市立小中学校全校の体育館に冷暖房の空調設備を設置）',
    publisher: '町田市教育委員会',
    url: 'https://www.city.machida.tokyo.jp/kodomo/kyoiku/kaigitou/kaigi/teireikairinjikai/kyoukai/2022kaigiroku/2022kaigiroku05.files/09_.pdf',
    as_of: '2022-08-01',
  },
} as const
type SourceId = keyof typeof SOURCES

for (const s of Object.values(SOURCES)) if (!existsSync(join(RAW, s.file))) throw new Error(`元の資料がありません: data/raw/public/${s.file}`)

// 施設データ
const munis = new Map<string, MuniFile>()
for (const f of readdirSync(muniDir)) munis.set(f.slice(0, 5), JSON.parse(readFileSync(join(muniDir, f), 'utf8')) as MuniFile)

type Entry = { value: string | boolean; source: SourceId; how: string }
const values = new Map<string, Record<string, Entry>>()
const set = (facilityId: string, key: string, e: Entry) => {
  const a = values.get(facilityId) ?? {}
  a[key] = e
  values.set(facilityId, a)
}
const report: Record<string, unknown> = {}

// 1. 文部科学省の市区町村別の率
{
  const pdf = join(RAW, SOURCES.mext_gym_aircon.file)
  const n = Number(execFileSync('pdfinfo', [pdf]).toString().match(/Pages:\s+(\d+)/)![1])
  const pages = Array.from({ length: n }, (_, i) => execFileSync('pdftotext', ['-f', String(i + 1), '-l', String(i + 1), '-bbox', pdf, '-']).toString('utf8'))
  const byPref = new Map<string, MuniName[]>()
  const geoDir = join(BUILD_DIR, 'geocode')
  for (const f of readdirSync(geoDir)) {
    const g = JSON.parse(readFileSync(join(geoDir, f), 'utf8')) as { pref_name: string; munis: { code: string; name: string; key: string }[] }
    byPref.set(g.pref_name, muniNamesFromGeocode(g.munis))
  }
  const { rates, problems } = parseMextRates(pages, byPref)
  // 学校組合の名前に出てくる市町村は、組合立の学校が率に入っていないので対象から外す
  const inUnion = new Set<string>()
  for (const u of rates.filter((r) => r.union)) for (const m of byPref.get(u.pref) ?? []) if (u.name.includes(m.name)) inUnion.add(m.key)
  let none = 0, present = 0, munisUsed = 0
  for (const r of rates) {
    if (!r.key || r.union || inUnion.has(r.key) || (r.rate !== 0 && r.rate !== 100)) continue
    const muni = munis.get(r.key)
    if (!muni) continue
    munisUsed++
    for (const f of muni.facilities.filter(isMunicipalSchoolShelter)) {
      const value = r.rate === 0 ? 'none' : 'present'
      set(f.id, 'aircon_main_hall', {
        value, source: 'mext_gym_aircon',
        how: `${muni.muni_name}の公立小中学校の体育館等の冷房設置率が ${r.rate}%。市区町村立の小中学校で指定避難所の施設について、主要な滞在スペースを体育館とみなした`,
      })
      if (value === 'none') none++; else present++
    }
  }
  report.mext_gym_aircon = {
    municipalities_read: rates.filter((r) => r.key).length,
    rate_0: rates.filter((r) => r.key && r.rate === 0).length,
    rate_100: rates.filter((r) => r.key && r.rate === 100).length,
    excluded_union_munis: inUnion.size,
    munis_used: munisUsed,
    facilities_none: none,
    facilities_present: present,
    problems,
  }
}

// 2. 自治体の設置一覧
function applyList(source: SourceId, muniKey: string, names: string[], key: string, value: string | boolean, how: string) {
  const muni = munis.get(muniKey)!
  const matched = matchListNames(names, muni.facilities)
  let hit = 0
  const miss: string[] = []
  for (const [name, f] of matched) {
    if (!f) { miss.push(name); continue }
    set(f.id, key, { value, source, how: `${how}（一覧の名称：${name}）` })
    hit++
  }
  report[source] = { listed: names.length, matched: hit, unmatched: miss }
}
{
  const txt = execFileSync('pdftotext', ['-layout', join(RAW, SOURCES.fukuoka_gym_aircon.file), '-']).toString('utf8')
  const names = txt.split('\n').map((l) => l.trim().split(/\s+/)).filter((c) => c.length >= 3 && /^[東博多中央南城早良西]+$/.test(c[0]!) && /(学校|学園)$/.test(c[1]!)).map((c) => c[1]!)
  applyList('fukuoka_gym_aircon', '40130', names, 'aircon_main_hall', 'present', '福岡市の体育館の空調機設置校一覧に掲載。主要な滞在スペースを体育館とみなした')
}
{
  const txt = execFileSync('pdftotext', ['-layout', join(RAW, SOURCES.sendai_solar_battery.file), '-']).toString('utf8')
  const names = [...txt.matchAll(/^\s*\d+\s+(\S+)\s+\S+区/gm)].map((m) => m[1]!)
  applyList('sendai_solar_battery', '04100', names, 'solar_battery', true, '仙台市の防災対応型太陽光発電システム（太陽光と蓄電池）導入施設一覧に掲載')
}
{
  const xml = execFileSync('unzip', ['-p', join(RAW, SOURCES.chiba_solar_battery.file), 'xl/sharedStrings.xml']).toString('utf8').replace(/<rPh.*?<\/rPh>/gs, '')
  const strings = [...xml.matchAll(/<si>(.*?)<\/si>/gs)].map((m) => m[1]!.replace(/<[^>]+>/g, ''))
  const names = strings.filter((s) => /(学校|公民館|センター|会館)$/.test(s))
  applyList('chiba_solar_battery', '12100', names, 'solar_battery', true, '千葉市の避難所への再生可能エネルギー等導入事業（太陽光発電設備と蓄電池）の導入施設一覧に掲載')
}

// 3. 暖房：市区町村が「市立小中学校の全校の体育館に暖房（冷暖房の空調）がある」と公表している場合（DATA_NOTES 16.8）
//    世田谷区・町田市は計画・報告の時点では設置途中の場合があるため、文科省の冷房設置率が 100% であること（全校で設置済み）も条件にする
function applyMuniStatement(source: SourceId, muniKey: string, how: string, needsMext100: boolean) {
  const muni = munis.get(muniKey)!
  let n = 0
  for (const f of muni.facilities.filter(isMunicipalSchoolShelter)) {
    if (needsMext100 && values.get(f.id)?.aircon_main_hall?.value !== 'present') continue
    set(f.id, 'heating_main_hall', { value: 'present', source, how })
    n++
  }
  report[source] = { municipality: muni.muni_name, facilities: n }
}
applyMuniStatement('sapporo_gym_heating', '01100',
  '札幌市の資料に、市立小中学校体育館 300 校の暖房の熱源の内訳（都市ガス 113 校・灯油 95 校・重油 58 校・電気 21 校・LP ガス 9 校ほか）がある。市立の小中学校で指定避難所の施設について、主要な滞在スペースを体育館とみなした。同じ資料は、停電や都市ガスの停止で暖房が使えなくなる想定も示している（都市ガスは復旧まで長期化）', false)
applyMuniStatement('setagaya_gym_aircon', '13112',
  '世田谷区は区立小中学校全 90 校の体育館に冷暖房機能を持つ空調機を設置する方針（2018 年）。文部科学省の調査（2026-05-01）で区の体育館等の冷房設置率が 100% のため、設置済みとした。主要な滞在スペースを体育館とみなした', true)
applyMuniStatement('machida_gym_aircon', '13209',
  '町田市は 2020〜2021 年度に市立小中学校全校の体育館に、壁輻射パネルと壁掛けエアコンによる冷暖房の空調を設置し、冬季は室温 19℃以下で運転している（2022 年の報告）。主要な滞在スペースを体育館とみなした', true)

// 書き出し。施設 ID の順に並べ、差分を読みやすくする
const sources: Record<string, AmenitySource & { file: string }> = {}
for (const [id, s] of Object.entries(SOURCES)) sources[id] = { ...s, how: '' }
const out = {
  generated_by: 'scripts/import-public-amenities.ts',
  note: '公的資料から取り込んだ施設ごとの設備の値（DATA_NOTES 16）。推定はしない。載っていない施設は未確認のまま',
  sources,
  values: Object.fromEntries([...values].sort(([a], [b]) => a.localeCompare(b))),
  report,
}
mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n')
console.log(JSON.stringify(report, (k, v) => (k === 'unmatched' || k === 'problems' ? (v as unknown[]).length : v), 1))
console.log(`施設 ${values.size} 件 → ${OUT}`)
