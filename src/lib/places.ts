// 「住所から探す」で利用者が保存した地点。この端末のブラウザ内だけに置く（SPEC §6.6）。
// 住所の文字列は保存しない。呼び名と確認済みの位置だけ。読み書きに失敗しても画面は動くようにする
export interface SavedPlace {
  label: string
  lat: number
  lng: number
  prefCode: string
  muniKey: string | null
}

const KEY = 'hinanbase:places:v1'

export function loadPlaces(): SavedPlace[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
    if (!Array.isArray(v)) return []
    return v.filter((p): p is SavedPlace =>
      typeof p?.label === 'string' && Number.isFinite(p?.lat) && Number.isFinite(p?.lng) && typeof p?.prefCode === 'string')
  } catch {
    return []
  }
}

export function savePlaces(places: SavedPlace[]): void {
  try {
    if (places.length === 0) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, JSON.stringify(places))
  } catch {
    // 保存できない環境（プライベートブラウズなど）では保存しない
  }
}

// 地図で最後に見ていた場所。次に開いたとき、全国ではなく自分の地域から表示するため（SPEC §6.1）。
// 位置とズームだけを、この端末のブラウザ内に置く
const VIEW_KEY = 'hinanbase:mapview:v1'
export type MapViewState = { lat: number; lng: number; zoom: number }

export function loadMapView(): MapViewState | null {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null') as Partial<MapViewState> | null
    if (v && Number.isFinite(v.lat) && Number.isFinite(v.lng) && Number.isFinite(v.zoom)) return v as MapViewState
  } catch {
    // 読めなければ全国から表示する
  }
  const first = loadPlaces()[0]
  return first ? { lat: first.lat, lng: first.lng, zoom: 13 } : null
}

export function saveMapView(v: MapViewState): void {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ lat: +v.lat.toFixed(4), lng: +v.lng.toFixed(4), zoom: +v.zoom.toFixed(1) }))
  } catch {
    // 保存できない環境では保存しない
  }
}
