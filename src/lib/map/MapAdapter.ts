// 地図の実装はこのインターフェース経由で使う（CLAUDE.md 絶対ルール 10、SPEC §5.3）
import { DISPLAY_STATES, HAZARD_KEYS, type DisplayState, type HazardKey } from '../../../shared/types.ts'

export interface MapFilter {
  kind: 'all' | 'emergency' | 'shelter'
  hazard: HazardKey | 'all'
  states: DisplayState[]
  /** 'none' なら、冷房なし（主要滞在スペースの冷房が「なし」で確定）の施設だけ */
  ac: 'all' | 'none'
}

export interface MapFeature {
  id: string
  name: string
  muni: string
  /** ビットフラグ。1=指定緊急避難場所、2=指定避難所 */
  kind: number
  /** 災害種別8種のビットマスク */
  hz: number
  state: DisplayState
  /** 避難所の指定がすべて受入対象者限定 */
  restrictedOnly: boolean
  lng: number
  lat: number
}

export interface MapLabels {
  zoomIn: string
  zoomOut: string
  locate: string
  locateUnavailable: string
  attributionBase: string
  attributionData: string
}

export type MapMountOptions =
  | { mode: 'national'; tilesUrl: string; labels: MapLabels }
  | { mode: 'single'; lat: number; lng: number; state: DisplayState; restrictedOnly: boolean; labels: MapLabels }

export interface MapAdapter {
  mount(container: HTMLElement, options: MapMountOptions): void
  setFilter(filter: MapFilter): void
  /** 施設が選ばれたとき（null は選択解除） */
  onSelect(callback: (feature: MapFeature | null) => void): void
  setSelected(id: string | null): void
  destroy(): void
}

/**
 * まとめ表示の件数に使える「合算済みの属性」を、絞り込みの条件ごとに返す。
 * 条件が 1 つまでなら、その属性の合計が正確な件数になる。2 つ以上重なると合算値からは求められない。
 */
export function clusterCountAttributes(filter: MapFilter): (string | string[])[] {
  const attrs: (string | string[])[] = []
  if (filter.hazard !== 'all') {
    // 災害種別の指定は緊急避難場所だけが持つので、「緊急避難場所 × 災害種別」は災害種別の件数と同じ
    attrs.push(`h${HAZARD_KEYS.indexOf(filter.hazard)}`)
    if (filter.kind === 'shelter') attrs.push('ns')
  } else if (filter.kind === 'emergency') attrs.push('ne')
  else if (filter.kind === 'shelter') attrs.push('ns')
  if (!DISPLAY_STATES.every((s) => filter.states.includes(s))) {
    attrs.push(filter.states.map((s) => `s${DISPLAY_STATES.indexOf(s)}`))
  }
  if (filter.ac === 'none') attrs.push('acn')
  return attrs
}

/** 件数が正確に出せない絞り込みの組み合わせか（条件が 2 つ以上重なったとき） */
export function isClusterCountUnavailable(filter: MapFilter): boolean {
  return clusterCountAttributes(filter).length > 1
}
