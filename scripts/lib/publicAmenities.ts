// 公的資料から施設ごとの設備の値を取り出す（DATA_NOTES 16.4）。推定はしない。
//   ・国の市区町村別の統計で率が 0% か 100% の市区町村だけ、施設の値として確定する
//   ・自治体の設置一覧は、載っている施設を「あり」とする。載っていない施設は未確認のまま（「なし」にしない）
import type { Facility } from '../../shared/types.ts'

export interface MuniName { name: string; key: string }

/** 郡名を外す（「○○郡△△町」→「△△町」）。「大和郡山市」「蒲郡市」のように名前の中の「郡」は外さない */
export const stripGun = (name: string) => (/[町村]$/.test(name) ? name.replace(/^.+?郡(?=.+[町村]$)/, '') : name)

/** ヶ・ケ・ヵ、旧字体の揺れを揃える（資料ごとに表記が違うため） */
export const normKana = (s: string) => s.normalize('NFKC').replace(/[ヶヵケ]/g, 'ケ').replace(/[檮梼]/g, '梼').replace(/[𥔎﨑]/gu, '崎')

/** 住所照合用データの市区町村（政令指定都市の区は市にまとめる）。郡名は外す */
export function muniNamesFromGeocode(munis: { code: string; name: string; key: string }[]): MuniName[] {
  const out = new Map<string, MuniName>()
  for (const m of munis) {
    const name = normKana(stripGun(m.code !== m.key ? m.name.replace(/^(.+?市).+区$/, '$1') : m.name))
    // 政令指定都市の区は市のキーでまとめる。施設データにない市町村（キーが空）はコードで分ける
    const id = m.key && m.code !== m.key ? m.key : m.code
    if (!out.has(id)) out.set(id, { name, key: m.key ?? '' })
  }
  return [...out.values()]
}

export interface MextRate {
  pref: string
  name: string
  /** 施設データの市区町村キー。学校組合など、市区町村でないものは空 */
  key: string
  union: boolean
  rate: number
}

/**
 * 文部科学省「空調（冷房）設備設置状況（小中学校・体育館等）」市区町村別グラフ（PDF）を、
 * pdftotext -bbox で取り出した語の位置から読む。棒の上の率と、棒の下の名前を、横位置（中心の x 座標）で対応づける。
 * 文字の並び順には頼らない。対応がつかない名前・率があるページは捨てる（推測で埋めない）
 */
export function parseMextRates(pagesBbox: string[], munisByPref: Map<string, MuniName[]>): { rates: MextRate[]; problems: string[] } {
  const rates: MextRate[] = []
  const problems: string[] = []
  for (const [i, xml] of pagesBbox.entries()) {
    const words = [...xml.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)]
      .flatMap((m) => {
        const [x0, y, x1, t] = [Number(m[1]), Number(m[2]), Number(m[3]), m[5]!.replace(/&amp;/g, '&')]
        // 隣の棒の率がつながって 1 語になることがある（「100%100%」）。等分して位置を割り当てる
        const parts = /^([\d.]+%){2,}$/.test(t) ? t.match(/[\d.]+%/g)! : [t]
        const w = (x1 - x0) / parts.length
        return parts.map((p, k) => ({ x: x0 + w * (k + 0.5), xMin: x0 + w * k, y, t: p }))
      })
    if (words.length === 0 || words.some((w) => w.t === '全国')) continue
    const title = words.find((w) => /^(.+?)(-\d+)?$/.test(w.t) && munisByPref.has(w.t.replace(/-\d+$/, '')))
    const prefName = title?.t.replace(/-\d+$/, '')
    if (!prefName) { if (!words.some((w) => w.t === '全国')) problems.push(`p${i + 1}: 都道府県名が読めない`); continue }
    const munis = munisByPref.get(prefName)!
    // 目盛り（左端の 0%〜100%）と平均の注記を除いた、% で終わる語が棒の率
    const pct = words.filter((w) => /^[\d.]+%$/.test(w.t))
    const axisX = Math.min(...pct.map((w) => w.xMin))
    const vals = pct.filter((w) => w.xMin > axisX + 12)
    // 名前：いちばん下の行（棒の下）に縦書きで並ぶ語
    const nameWords = words.filter((w) => !/[%％\d]/.test(w.t))
    const ys = new Map<number, number>()
    for (const w of nameWords) ys.set(Math.round(w.y), (ys.get(Math.round(w.y)) ?? 0) + 1)
    const labelY = [...ys].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0
    // 縦書きの名前は、語の左端＋半角分が棒の中心に当たる
    const labels = nameWords.filter((w) => Math.abs(w.y - labelY) <= 3).map((w) => ({ ...w, x: w.xMin })).sort((a, b) => a.x - b.x)
    if (labels.length !== vals.length) { problems.push(`p${i + 1} ${prefName}: 名前 ${labels.length} と率 ${vals.length} の数が合わない`); continue }
    const pitch = labels.length > 1 ? (labels.at(-1)!.x - labels[0]!.x) / (labels.length - 1) : 10
    let bad = false
    const used = new Set<number>()
    const row: MextRate[] = []
    for (const l of labels) {
      let best = -1
      for (const [j, v] of vals.entries()) if (!used.has(j) && (best < 0 || Math.abs(v.x - l.x) < Math.abs(vals[best]!.x - l.x))) best = j
      if (best < 0 || Math.abs(vals[best]!.x - l.x) > pitch / 2) { bad = true; break }
      used.add(best)
      const name = normKana(l.t)
      const union = /(組合|広域連合)$/.test(name)
      const m = union ? undefined : munis.find((x) => x.name === name)
      if (!union && !m && name !== normKana(prefName)) { problems.push(`p${i + 1} ${prefName}: 名前が市区町村と一致しない「${name}」`); bad = true; break }
      row.push({ pref: prefName, name, key: m?.key ?? '', union, rate: Number(vals[best]!.t.replace('%', '')) })
    }
    if (bad) { problems.push(`p${i + 1} ${prefName}: 率と名前の位置が対応しない`); continue }
    rates.push(...row)
  }
  return { rates, problems }
}

const PUBLIC_SCHOOL = /(小学校|中学校|義務教育学校)/
const NOT_MUNICIPAL_SCHOOL = /(高等学校|高校|大学|附属|付属|私立|県立|府立|都立|道立|国立|特別支援|養護|跡|旧|閉校|廃校)/
const GROUND_ONLY = /(グラウンド|グランド|校庭|運動場|プール)$/

/** 市区町村立の小中学校で、指定避難所の指定がある施設か（文科省の調査対象と重なるもの） */
export function isMunicipalSchoolShelter(f: Facility): boolean {
  if (f.designations.shelter.length === 0) return false
  const n = f.name.normalize('NFKC')
  return PUBLIC_SCHOOL.test(n) && !NOT_MUNICIPAL_SCHOOL.test(n) && !GROUND_ONLY.test(n)
}

/** 施設名の照合用の正規化：空白・括弧書き・「○○市立」などの設置者名を外し、ヶ／ケ・ノ／の を揃える */
export function normFacilityName(s: string): string {
  return s.normalize('NFKC')
    .replace(/\s/g, '')
    .replace(/[（(].*?[)）]/g, '')
    .replace(/^.{1,6}?(市|町|村|区)立/, '')
    .replace(/^(市立|町立|村立|区立)/, '')
    .replace(/[ヶヵケ]/g, 'ケ')
    .replace(/之/g, 'の')
}

/**
 * 一覧の施設名を、市区町村内の施設に対応づける。同名が複数あれば指定避難所のものに絞り、それでも複数なら対応づけない。
 * 戻り値は一覧の名前 → 施設（対応できなければ undefined）
 */
export function matchListNames(names: string[], facilities: Facility[]): Map<string, Facility | undefined> {
  const byName = new Map<string, Facility[]>()
  for (const f of facilities) {
    const k = normFacilityName(f.name)
    byName.set(k, [...(byName.get(k) ?? []), f])
  }
  const out = new Map<string, Facility | undefined>()
  for (const raw of names) {
    let hits = byName.get(normFacilityName(raw)) ?? []
    if (hits.length > 1) hits = hits.filter((f) => f.designations.shelter.length > 0)
    out.set(raw, hits.length === 1 ? hits[0] : undefined)
  }
  return out
}
