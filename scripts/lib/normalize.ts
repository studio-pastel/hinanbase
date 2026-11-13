/** 照合用の施設名：NFKC 正規化して空白をすべて除く（DATA_NOTES 7.3） */
export function normalizeName(s: string): string {
  return s.normalize('NFKC').replace(/\s+/g, '')
}

/** 括弧書きを除いた照合用の施設名（規則 R2 用） */
export function coreName(s: string): string {
  return normalizeName(s).replace(/[([【「『<〈].*?[)\]】」』>〉]/g, '')
}

/** 表示用：前後の空白を落とし、セル内改行を空白1つにする。それ以外は原文のまま */
export function cleanText(s: string): string {
  return s.replace(/\s*\r?\n\s*/g, ' ').trim()
}

export function nullIfEmpty(s: string): string | null {
  const t = cleanText(s)
  return t === '' ? null : t
}

/** 2点間の距離（m） */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLng = (b.lng - a.lng) * rad
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 6371000 * 2 * Math.asin(Math.sqrt(h))
}
