// 地図の検索窓：住所・地名から都道府県を決め、端末の中で照合する（SPEC §6.1、§6.6、D-33）。
// 住所は外部に送らない。取得するのは都道府県の照合用ファイルだけ
import { geocode, normalizeAddress, type GeocodeFile, type GeocodeHit } from '../../shared/geocode.ts'
import type { MuniIndexFile, PrefIndexEntry } from '../../shared/types.ts'
import { fetchGeocode } from './data.ts'

const stripPrefSuffix = (name: string) => (name === '北海道' ? name : name.replace(/[都府県]$/, ''))
/** 郡名を外す（「○○郡△△町」→「△△町」）。「大和郡山市」「蒲郡市」の「郡」は外さない */
const stripGun = (name: string) => (/[町村]$/.test(name) ? name.replace(/^.+?郡(?=.+[町村]$)/, '') : name)

/**
 * 住所の先頭から都道府県の候補を決める。
 *   都道府県名（「東京」のように都府県を省いても可）で始まればその 1 つ。
 *   それ以外は市区町村名で始まる都道府県をすべて返す（「府中市」は東京都と広島県）
 */
export function resolvePrefs(address: string, index: MuniIndexFile): PrefIndexEntry[] {
  const a = normalizeAddress(address)
  for (const p of index.prefs) {
    if (a.startsWith(p.name) || a.startsWith(stripPrefSuffix(p.name))) return [p]
  }
  const hits = index.prefs.filter((p) => p.munis.some((m) => {
    const n = normalizeAddress(m.name)
    return n.length > 1 && (a.startsWith(n) || a.startsWith(stripGun(n)))
  }))
  return hits
}

/** 都道府県名を省いた住所でも照合できるよう、都道府県名を付けてから照合する */
function withPref(address: string, pref: PrefIndexEntry): string {
  const a = normalizeAddress(address)
  if (a.startsWith(pref.name)) return a
  const short = stripPrefSuffix(pref.name)
  return pref.name + (a.startsWith(short) ? a.slice(short.length) : a)
}

export type SearchOutcome =
  | { status: 'found'; hit: GeocodeHit; pref: PrefIndexEntry }
  | { status: 'choose_town'; candidates: GeocodeHit[]; pref: PrefIndexEntry }
  | { status: 'choose_pref'; prefs: PrefIndexEntry[] }
  | { status: 'muni_only'; hit: GeocodeHit; pref: PrefIndexEntry }
  | { status: 'not_found' }

export async function searchAddress(address: string, index: MuniIndexFile, pref?: PrefIndexEntry): Promise<SearchOutcome> {
  const prefs = pref ? [pref] : resolvePrefs(address, index)
  if (prefs.length === 0) return { status: 'not_found' }
  if (prefs.length > 1) return { status: 'choose_pref', prefs }
  const p = prefs[0]!
  const file = await loadGeocode(p.code)
  const r = geocode(withPref(address, p), file)
  if (r.status === 'found') return { status: 'found', hit: r.hit, pref: p }
  if (r.status === 'choose') return { status: 'choose_town', candidates: r.candidates, pref: p }
  if (r.muni) return { status: 'muni_only', hit: r.muni, pref: p }
  return { status: 'not_found' }
}

/** 入力候補 */
export type Suggestion =
  | { kind: 'muni'; label: string; sub: string; pref: PrefIndexEntry; query: string }
  | { kind: 'town'; label: string; sub: string; hit: GeocodeHit }

const SUGGEST_LIMIT = 8
const stripMuniSuffix = (n: string) => n.replace(/[都道府県市区町村]$/, '')

/**
 * 市区町村の候補：名前の一部に入力が含まれるもの（「世田谷」→ 世田谷区、「よこはま」は対象外）。
 * 前方一致を先に、次に部分一致。都道府県名だけの入力なら、その都道府県の市区町村を並べる
 */
export function suggestMunis(input: string, index: MuniIndexFile): Suggestion[] {
  const all = normalizeAddress(input)
  if (!all) return []
  for (const p of index.prefs) {
    for (const n of [p.name, stripPrefSuffix(p.name)]) {
      if (!all.startsWith(n)) continue
      const r = rankMunis(all.slice(n.length), [p])
      // 「大阪市」「京都市」のように都府県を省いた名前が市名の頭と重なる場合は、市名としても照合する
      if (r.length > 0 || n === p.name) return r
      return rankMunis(all, index.prefs)
    }
  }
  return rankMunis(all, index.prefs)
}

function rankMunis(q: string, pool: PrefIndexEntry[]): Suggestion[] {
  const scored: { s: number; sg: Suggestion }[] = []
  for (const p of pool) {
    for (const m of p.munis) {
      const n = normalizeAddress(m.name)
      const short = stripGun(n)
      // 入力が市区町村名より長い（町名まで入っている）場合は、市区町村名で始まるかを見る
      const score = !q ? 2
        : short.startsWith(q) || n.startsWith(q) ? 0
          : q.startsWith(short) || q.startsWith(n) ? 0
            : stripMuniSuffix(short).includes(q) ? 1 : -1
      if (score < 0) continue
      scored.push({ s: score, sg: { kind: 'muni', label: m.name, sub: p.name, pref: p, query: p.name + m.name } })
    }
  }
  return scored.sort((a, b) => a.s - b.s).slice(0, SUGGEST_LIMIT).map((x) => x.sg)
}

/** 町名の候補：入力が「市区町村名＋町名の一部」のとき、照合用ファイルからその市区町村の町名を前方一致で出す */
export function suggestTowns(input: string, pref: PrefIndexEntry, file: GeocodeFile): Suggestion[] {
  const raw = normalizeAddress(input)
  const pn = normalizeAddress(file.pref_name)
  // 都道府県名を省いた形も試す（「大阪市」の「大阪」を府名として削らない）
  const variants = [...new Set([raw.startsWith(pn) ? raw.slice(pn.length) : raw, raw.startsWith(stripPrefSuffix(pn)) ? raw.slice(stripPrefSuffix(pn).length) : raw, raw])]
  const order = file.munis.map((m, i) => ({ m, i })).sort((x, y) => y.m.name.length - x.m.name.length)
  for (const { m, i } of order) {
    for (const [n, a] of [normalizeAddress(m.name), stripGun(normalizeAddress(m.name))].flatMap((n) => variants.map((a) => [n, a] as const))) {
      if (!a.startsWith(n)) continue
      const rest = a.slice(n.length).replace(/^大字/, '').replace(/[-\d].*$/, '')
      if (!rest) return /市.+区$/.test(m.name) ? [{ kind: 'muni', label: m.name, sub: pref.name, pref, query: pref.name + m.name }] : []
      const out: Suggestion[] = []
      for (const t of file.towns) {
        if (t[0] !== i) continue
        const tn = normalizeAddress(t[1]).replace(/^大字/, '')
        if (rest && !tn.startsWith(rest)) continue
        out.push({ kind: 'town', label: t[1], sub: `${pref.name}${m.name}`, hit: { muni: m, town: t[1], lat: t[2], lng: t[3], level: 'town' } })
        if (out.length >= SUGGEST_LIMIT) break
      }
      return out
    }
  }
  // 政令指定都市の区：「大阪市北」→ 大阪市北区
  const wards: Suggestion[] = []
  for (const m of file.munis) {
    const n = normalizeAddress(m.name)
    if (variants.some((a) => a && n.length > a.length && n.startsWith(a)) && /市.+区$/.test(m.name)) {
      wards.push({ kind: 'muni', label: m.name, sub: pref.name, pref, query: pref.name + m.name })
      if (wards.length >= SUGGEST_LIMIT) break
    }
  }
  return wards
}

/** 都道府県の照合用ファイルは、一度取得したらこの画面を開いている間は使い回す */
const geocodeCache = new Map<string, Promise<GeocodeFile>>()
export function loadGeocode(prefCode: string): Promise<GeocodeFile> {
  let p = geocodeCache.get(prefCode)
  if (!p) {
    p = fetchGeocode(prefCode)
    p.catch(() => geocodeCache.delete(prefCode))
    geocodeCache.set(prefCode, p)
  }
  return p
}
