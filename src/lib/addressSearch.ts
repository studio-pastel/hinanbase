// 地図の検索窓：住所・地名から都道府県を決め、端末の中で照合する（SPEC §6.1、§6.6、D-33）。
// 住所は外部に送らない。取得するのは都道府県の照合用ファイルだけ
import { geocode, normalizeAddress, type GeocodeHit } from '../../shared/geocode.ts'
import type { MuniIndexFile, PrefIndexEntry } from '../../shared/types.ts'
import { fetchGeocode } from './data.ts'

const stripPrefSuffix = (name: string) => (name === '北海道' ? name : name.replace(/[都府県]$/, ''))
const stripGun = (name: string) => name.replace(/^.+?郡/, '')

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
  const file = await fetchGeocode(p.code)
  const r = geocode(withPref(address, p), file)
  if (r.status === 'found') return { status: 'found', hit: r.hit, pref: p }
  if (r.status === 'choose') return { status: 'choose_town', candidates: r.candidates, pref: p }
  if (r.muni) return { status: 'muni_only', hit: r.muni, pref: p }
  return { status: 'not_found' }
}
