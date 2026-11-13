// 地図の実装はこのインターフェース経由で使う（CLAUDE.md 絶対ルール 10、SPEC §5.3）
import type { DisplayState, HazardKey } from '../../../shared/types.ts'

export interface MapFilter {
  kind: 'all' | 'emergency' | 'shelter'
  hazard: HazardKey | 'all'
  states: DisplayState[]
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

/** 件数が正確に出せない絞り込みの組み合わせか（避難所 × 災害種別。DATA_NOTES 参照） */
export function isClusterCountUnavailable(filter: MapFilter): boolean {
  return filter.kind === 'shelter' && filter.hazard !== 'all'
}
