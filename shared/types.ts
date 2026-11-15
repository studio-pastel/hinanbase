// ビルドスクリプトとフロントエンドが共有する静的データの型（docs/SPEC.md §2.4、docs/DATA_NOTES.md D-12）

export const HAZARD_KEYS = [
  'flood',
  'landslide',
  'storm_surge',
  'earthquake',
  'tsunami',
  'fire',
  'inland_flood',
  'volcano',
] as const
export type HazardKey = (typeof HAZARD_KEYS)[number]
export type Hazards = Record<HazardKey, boolean>

export const KIND_EMERGENCY = 1
export const KIND_SHELTER = 2

export const DISPLAY_STATES = ['unknown', 'critical', 'poor', 'fair', 'good'] as const
export type DisplayState = (typeof DISPLAY_STATES)[number]

/** 想定区域との照合結果。'in' は区域内、'none' は色が付いていない（区域外とは限らない。未整備の場合もある） */
export type ZoneResult = 'in' | 'none'

/** 軸A（ハザード適合性）の結果。点数は出さない（SPEC §3.2） */
export interface HazardCheck {
  /** attention=要確認の種別がある / no_overlap_found=確認できる範囲では重なりなし / not_evaluated=未評価 */
  status: 'attention' | 'no_overlap_found' | 'not_evaluated'
  /** 指定されていて、想定区域と重なっていた災害種別 */
  overlap: HazardKey[]
  /** 照合できた災害種別（overlap を含む） */
  checked: HazardKey[]
  /** 指定されているが照合できていない災害種別（対応するデータがない、または未取得） */
  unchecked: HazardKey[]
}

export interface EmergencyDesignation {
  source_id: string
  name: string
  hazards: Hazards
  /** 指定されている災害種別ごとの、想定区域との照合結果（照合できたものだけ） */
  zone?: Partial<Record<HazardKey, ZoneResult>>
  note: string | null
  lat: number
  lng: number
}

export interface ShelterDesignation {
  source_id: string
  name: string
  /** 受入対象者を限定した避難所か（DATA_NOTES D-11） */
  restricted: boolean
  target: string | null
  other: string | null
  note: string | null
  lat: number
  lng: number
}

/** 最寄りの緊急輸送道路（国土数値情報 N10）。軸D に使う（SPEC §3.5、DATA_NOTES 12.6） */
export interface RoadAccess {
  /** 最寄りの緊急輸送道路までの直線距離（m）。探した範囲に道路がなければ null */
  distance_m: number | null
  /** 探した範囲（m）。distance_m が null のとき、これより遠いことだけが分かっている */
  searched_m: number
  /** 区分：1=第1次 2=第2次 3=第3次 9=未指定 */
  class: number | null
  /** 道路種別：3=一般国道 4=主要地方道（都道府県道）ほか。高速自動車国道・都市高速道路は対象外 */
  road_type: number | null
  name: string | null
  /** もとの計画図などの年月（例：'2016 03'） */
  source_ym: string | null
}

export interface AmenityValue {
  value: string | number | boolean
  confidence: 'official' | 'verified' | 'reported' | 'disputed'
  observed_at: string | null
  evidence_count: number
}

export interface Scores {
  hazard: number | null
  capacity: number | null
  habitability: number | null
  logistics: number | null
  coverage_ratio: number
  display_state: DisplayState
  hazard_check: HazardCheck
  breakdown: Record<string, unknown>
}

export interface Facility {
  id: string
  name: string
  address: string
  lat: number
  lng: number
  designations: {
    emergency_site: EmergencyDesignation[]
    shelter: ShelterDesignation[]
  }
  /** この施設を作るときに適用した統合規則（DATA_NOTES 7.3）。統合なしは空配列 */
  merge_rules: string[]
  /** 最寄りの緊急輸送道路。指定避難所の指定がある施設にだけ付ける。未計算なら項目自体がない */
  road?: RoadAccess
  amenities: Record<string, AmenityValue>
  scores: Scores
}

export interface MuniFile {
  muni_key: string
  pref_code: string
  pref_name: string
  muni_name: string
  generated_at: string
  facilities: Facility[]
}

export interface MuniIndexEntry {
  key: string
  name: string
  count: number
}
export interface PrefIndexEntry {
  code: string
  name: string
  count: number
  munis: MuniIndexEntry[]
}
export interface MuniIndexFile {
  generated_at: string
  prefs: PrefIndexEntry[]
}

export interface NationalSummary {
  generated_at: string
  facility_count: number
  muni_count: number
  by_kind: { emergency_only: number; shelter_only: number; both: number }
  /** 避難所の指定がすべて受入対象者限定である施設の数 */
  restricted_only_count: number
  hazards: Record<HazardKey, number>
  display_state: Record<DisplayState, number>
  amenity_coverage: { facilities_with_any: number; ratio: number }
}

export interface Meta {
  schema_version: number
  generated_at: string
  d1_fetched_date: string
  source_rows: { shelter: number; emergency: number }
  facility_count: number
  merge: Record<string, number>
  merge_candidates: Record<string, number>
}
