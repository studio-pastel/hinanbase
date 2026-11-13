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

export interface EmergencyDesignation {
  source_id: string
  name: string
  hazards: Hazards
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
