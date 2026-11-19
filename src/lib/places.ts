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
