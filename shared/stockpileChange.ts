// 備蓄の数の比べ（DATA_NOTES 20）。国の調査（令和 6 年 11 月 1 日時点）と、その後に都道府県が公表した数を品目ごとに並べる。
// 両方に数がある品目だけ。集め方・品目の分け方が違うことがあるので、3 倍以上・3 分の 1 以下の違いと 0 をまたぐ違いは差を出さず「要確認」にする。

export type ChangeKind = 'same' | 'up' | 'down' | 'check'
export interface ChangeRow { key: string; before: number; after: number; kind: ChangeKind; diff: number | null }

/** この倍率以上・以下の違いは「要確認」 */
export const CHECK_RATIO = 3

export function compareStockpile(order: string[], before: Record<string, number | string>, after: Record<string, number | string>): ChangeRow[] {
  const rows: ChangeRow[] = []
  for (const key of order) {
    const b = before[key], a = after[key]
    if (typeof b !== 'number' || typeof a !== 'number') continue
    let kind: ChangeKind
    if (a === b) kind = 'same'
    else if (a === 0 || b === 0 || a / b >= CHECK_RATIO || b / a >= CHECK_RATIO) kind = 'check'
    else kind = a > b ? 'up' : 'down'
    rows.push({ key, before: b, after: a, kind, diff: kind === 'up' || kind === 'down' ? a - b : null })
  }
  return rows
}
