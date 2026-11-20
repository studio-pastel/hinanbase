// 地図の実装はこのインターフェース経由で使う（CLAUDE.md 絶対ルール 10、SPEC §5.3）
import { DISPLAY_STATES, HAZARD_KEYS, type DisplayState, type HazardKey } from '../../../shared/types.ts'

export interface MapFilter {
  kind: 'all' | 'emergency' | 'shelter'
  hazard: HazardKey | 'all'
  states: DisplayState[]
  /** 'none' なら、冷房なし（主要滞在スペースの冷房が「なし」で確定）の施設だけ */
  ac: 'all' | 'none'
  /** 'only' なら、指定された災害種別がその災害の想定区域と重なっている施設だけ（軸A が「要確認」） */
  overlap: 'all' | 'only'
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
  /** 想定区域と重なる（軸A が要確認） */
  attention: boolean
  /** 地点の指標（属性がないものは undefined = 未確認） */
  metrics: { flood?: number; tsunami?: number; storm_surge?: number; landslide?: number; road?: number }
  /** 設備の観点ごとの状態（0=未確認 1=充足 2=一部 3=不足）と、不足が確定した設備の key */
  impact: { life: number; health: number; dignity: number; access: number }
  shortKeys: string[]
  lng: number
  lat: number
}

/** 地図に重ねるハザードマップ（ハザードマップポータルサイトの表示用タイル） */
export const HAZARD_OVERLAYS = ['flood', 'landslide', 'tsunami', 'storm_surge'] as const
export type HazardOverlay = (typeof HAZARD_OVERLAYS)[number]

/** 地図の色分け。state は表示状態（設備）。それ以外は施設の地点の指標で、全施設を点で描く（DATA_NOTES 14.5） */
export const COLOR_BYS = ['state', 'flood', 'tsunami', 'storm_surge', 'landslide', 'road'] as const
export type ColorBy = (typeof COLOR_BYS)[number]
/** 指標ごとのタイルの属性と、階級ごとの色（浸水深・土砂はハザードマップポータルサイトの凡例の色） */
export const METRIC_SCALES: Record<Exclude<ColorBy, 'state'>, { attr: string; colors: string[] }> = {
  flood: { attr: 'fd', colors: ['#ffffff', '#F7F5A9', '#FFD8C0', '#FFB7B7', '#FF9191', '#F285C9'] },
  tsunami: { attr: 'td', colors: ['#ffffff', '#F7F5A9', '#FFD8C0', '#FFB7B7', '#FF9191', '#F285C9'] },
  storm_surge: { attr: 'sd', colors: ['#ffffff', '#F7F5A9', '#FFD8C0', '#FFB7B7', '#FF9191', '#F285C9'] },
  landslide: { attr: 'ls', colors: ['#ffffff', '#E6C832', '#A50021'] },
  road: { attr: 'rd', colors: ['#c6dbef', '#6baed6', '#2171b5', '#08306b'] },
}
export const METRIC_UNKNOWN_COLOR = '#9a9a9a'

export interface MapLabels {
  zoomIn: string
  zoomOut: string
  locate: string
  locateUnavailable: string
  attributionBase: string
  attributionData: string
  attributionHazard: string
}

export type MapMountOptions =
  /** view を渡すと、その位置から表示する（前回見ていた場所など） */
  | { mode: 'national'; tilesUrl: string; pointsUrl?: string; labels: MapLabels; view?: { lat: number; lng: number; zoom: number } }
  | { mode: 'single'; lat: number; lng: number; state: DisplayState; restrictedOnly: boolean; labels: MapLabels }
  /** 地点を選ぶ（「住所から探す」で、照合した位置を確認・調整する）。施設も表示する。地図をタップすると地点が動く */
  | { mode: 'pick'; tilesUrl: string; lat: number; lng: number; zoom: number; labels: MapLabels }

export interface MapAdapter {
  mount(container: HTMLElement, options: MapMountOptions): void
  setFilter(filter: MapFilter): void
  /** 施設が選ばれたとき（null は選択解除） */
  onSelect(callback: (feature: MapFeature | null) => void): void
  setSelected(id: string | null): void
  /** 地点の印を置き（national・pick モード）、その位置を地図の中心にする */
  setPin(lat: number, lng: number, zoom?: number): void
  /** 地図を動かし終えたとき（表示している位置を端末に覚えておくため） */
  onViewChange(callback: (lat: number, lng: number, zoom: number) => void): void
  /** 地点（pick モード）を地図のタップで動かしたとき */
  onPick(callback: (lat: number, lng: number) => void): void
  /** ハザードマップを重ねる（null で消す）。施設の印より下に描く */
  setHazardOverlay(overlay: HazardOverlay | null): void
  /** 色分けの指標を切り替える（national モード） */
  setColorBy(colorBy: ColorBy): void
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
  if (filter.overlap === 'only') attrs.push('hm')
  return attrs
}

/** 件数が正確に出せない絞り込みの組み合わせか（条件が 2 つ以上重なったとき） */
export function isClusterCountUnavailable(filter: MapFilter): boolean {
  return clusterCountAttributes(filter).length > 1
}
