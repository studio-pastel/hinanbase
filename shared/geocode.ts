// 住所を町丁目の代表点に照合する（SPEC §6.6、DATA_NOTES 13 章）。
// 利用者の端末の中だけで動かす。住所を外部に送らない（D-33）。ビルドとテストからも使う。

/** 照合用ファイル（geocode/{都道府県コード}.json）の形 */
export interface GeocodeFile {
  pref_code: string
  pref_name: string
  source: string
  /** 市区町村。key は本サービスの市区町村コード（政令指定都市の区は市のコード）。施設データにない場合は null */
  munis: { code: string; name: string; key: string | null }[]
  /** [市区町村の番号, 大字町丁目名, 緯度, 経度, 区分（1=大字 2=字 3=丁目）] */
  towns: [number, string, number, number, number][]
}

export interface GeocodeHit {
  muni: { code: string; name: string; key: string | null }
  town: string
  lat: number
  lng: number
  /** 町丁目まで当たったか、市区町村だけか */
  level: 'town' | 'muni'
}

export type GeocodeResult =
  | { status: 'found'; hit: GeocodeHit }
  | { status: 'choose'; candidates: GeocodeHit[] }
  | { status: 'not_found'; muni: GeocodeHit | null }

const KAN = '〇一二三四五六七八九'
export function toKanjiNumber(n: number): string {
  if (n < 10) return KAN[n]!
  if (n < 20) return '十' + (n % 10 ? KAN[n % 10] : '')
  if (n < 100) return KAN[Math.floor(n / 10)]! + '十' + (n % 10 ? KAN[n % 10] : '')
  return String(n)
}

/** 照合用の正規化：全角・半角、空白、「ヶ・ケ」、長音とハイフン、「1丁目」→「一丁目」 */
export function normalizeAddress(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .replace(/[ヶヵ]/g, 'ケ')
    .replace(/[‐－―−–—]/g, '-')
    .replace(/(\d+)丁目/g, (_, n: string) => toKanjiNumber(Number(n)) + '丁目')
}

const stripGun = (name: string) => name.replace(/^.+?郡/, '')
const stripOaza = (s: string) => s.replace(/^大字/, '')

function centroid(points: { lat: number; lng: number }[]) {
  const n = points.length
  return { lat: points.reduce((s, p) => s + p.lat, 0) / n, lng: points.reduce((s, p) => s + p.lng, 0) / n }
}

/**
 * 住所（都道府県名は省略可）を照合する。
 *   1) 市区町村名（郡名の有無を問わない）を前方一致で決める
 *   2) 残りの先頭に一致する町丁目のうち、いちばん長い名前を選ぶ。「本町2-3」は「本町二丁目」とみなす
 *   3) 丁目が書かれていないなど、複数の丁目にまたがる場合は候補を返す
 */
export function geocode(address: string, file: GeocodeFile): GeocodeResult {
  let a = normalizeAddress(address)
  const pref = normalizeAddress(file.pref_name)
  if (a.startsWith(pref)) a = a.slice(pref.length)

  // 市区町村：長い名前から順に試す（「市川市」と「市川三郷町」などの取り違えを防ぐ）
  const order = file.munis.map((m, i) => ({ m, i })).sort((x, y) => y.m.name.length - x.m.name.length)
  let muniIdx = -1
  let rest = ''
  for (const { m, i } of order) {
    for (const n of [m.name, stripGun(m.name)]) {
      const nn = normalizeAddress(n)
      if (a.startsWith(nn)) { muniIdx = i; rest = a.slice(nn.length); break }
    }
    if (muniIdx >= 0) break
  }
  if (muniIdx < 0) return { status: 'not_found', muni: null }
  const muni = file.munis[muniIdx]!
  const towns = file.towns.filter((t) => t[0] === muniIdx).map((t) => ({ name: t[1], norm: stripOaza(normalizeAddress(t[1])), lat: t[2], lng: t[3] }))
  const hit = (t: { name: string; lat: number; lng: number }): GeocodeHit => ({ muni, town: t.name, lat: t.lat, lng: t.lng, level: 'town' })
  const muniHit = (): GeocodeHit | null => (towns.length ? { muni, town: '', ...centroid(towns), level: 'muni' } : null)

  rest = stripOaza(rest)
  const tries = [rest]
  // 「本町2-3-4」「本町2番」→「本町二丁目」
  const m = rest.match(/^(\D+?)(\d+)(?:-|番|$)/)
  if (m) tries.push(m[1]! + toKanjiNumber(Number(m[2])) + '丁目')
  for (const r of tries.reverse()) {
    const found = towns.filter((t) => t.norm && r.startsWith(t.norm)).sort((x, y) => y.norm.length - x.norm.length)[0]
    if (found) return { status: 'found', hit: hit(found) }
  }
  // 丁目が書かれていない：「綾瀬」→ 綾瀬一丁目〜七丁目 を候補にする
  const base = (m ? m[1]! : rest).replace(/[-\d].*$/, '')
  if (base) {
    const cands = towns.filter((t) => t.norm.startsWith(base) && /丁目$/.test(t.norm) && t.norm.slice(base.length).replace(/[〇一二三四五六七八九十]+丁目$/, '') === '')
    if (cands.length > 0) return { status: 'choose', candidates: cands.map(hit) }
  }
  return { status: 'not_found', muni: muniHit() }
}

/** 2 点間の直線距離（m）。近距離用の近似 */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const k = Math.cos((a.lat * Math.PI) / 180)
  return Math.hypot((a.lng - b.lng) * k, a.lat - b.lat) * 111_320
}

/** 施設の位置ファイル（points/{緯度}_{経度}.json）の 1 件 */
export type PointRow = [id: string, muniKey: string, name: string, lat: number, lng: number, kind: number, state: string, restrictedOnly: 0 | 1, hazardAttention: 0 | 1, hazardMask: number]

/** 地点を中心とする半径 r（m）の円にかかる、緯度経度 1 度の区画 */
export function pointCells(lat: number, lng: number, r: number): string[] {
  const dLat = r / 111_320
  const dLng = r / (111_320 * Math.cos((lat * Math.PI) / 180))
  const out: string[] = []
  for (let y = Math.floor(lat - dLat); y <= Math.floor(lat + dLat); y++) {
    for (let x = Math.floor(lng - dLng); x <= Math.floor(lng + dLng); x++) out.push(`${y}_${x}`)
  }
  return out
}

export const NEAR_RADIUS_M = 3000
export const NEAR_MIN_COUNT = 5

/** 半径 3km 以内を近い順に。3km 以内に 1 件もなければ最寄りの 5 件 */
export function nearest(rows: PointRow[], at: { lat: number; lng: number }) {
  const all = rows.map((r) => ({ row: r, d: distanceM(at, { lat: r[3], lng: r[4] }) })).sort((a, b) => a.d - b.d)
  const within = all.filter((x) => x.d <= NEAR_RADIUS_M)
  return within.length > 0 ? { items: within, mode: 'radius' as const } : { items: all.slice(0, NEAR_MIN_COUNT), mode: 'nearest' as const }
}
