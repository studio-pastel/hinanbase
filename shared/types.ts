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

/** 自治体が公表している想定収容人数（SPEC §2.3 の D3、DATA_NOTES D-28）。指定ごとに持ち、市民投稿の設備値とは混ぜない */
export interface PublishedCapacity {
  persons: number
  /** もとの文字列。算出の前提が書かれていることがある（「1,350人（3.3平方メートルあたり2人）」など） */
  raw: string
  /** 自治体の一覧での名称。指定の名称と違う場合があるので残す */
  listed_name: string
  /** 公表している自治体と、データの名称・利用条件・掲載ページ・取得日 */
  source: { publisher: string; title: string; license: string; page_url: string; fetched_date: string }
}

export interface EmergencyDesignation {
  source_id: string
  name: string
  hazards: Hazards
  /** 指定されている災害種別ごとの、想定区域との照合結果（照合できたものだけ） */
  zone?: Partial<Record<HazardKey, ZoneResult>>
  capacity?: PublishedCapacity
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
  capacity?: PublishedCapacity
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
  /**
   * 5km 以上離れている施設だけに付ける。施設と同じ「ひと続きの陸地」に緊急輸送道路の指定があるか。
   * no_road=ない（島など。軸D は未評価にする） / has_road=ある / large_land=大きな陸地で調べきれない（あるものとして扱う） / outside=陸地の面の外で判定できない
   */
  land?: 'no_road' | 'has_road' | 'large_land' | 'outside'
}

export interface AmenityValue {
  value: string | number | boolean
  confidence: 'official' | 'verified' | 'reported' | 'disputed'
  observed_at: string | null
  evidence_count: number
  /** 公的資料から取り込んだ値の出典（DATA_NOTES 16.4）。市民投稿の確定値には付かない */
  source?: AmenitySource
}

/** 公的資料の出典。as_of は資料の時点、how はその値になった理由 */
export interface AmenitySource {
  title: string
  publisher: string
  url: string
  as_of: string
  how: string
}

/** 設備の影響の観点（DATA_NOTES 16.3） */
export const IMPACTS = ['life', 'health', 'dignity', 'access'] as const
export type Impact = (typeof IMPACTS)[number]
/** 観点ごとの状態：不足が確定／一部／充足／未確認 */
export type ImpactStatus = 'short' | 'limited' | 'ok' | 'unknown'

export interface Scores {
  hazard: number | null
  capacity: number | null
  logistics: number | null
  /** 設備の観点ごとの状態（総合点は作らない） */
  impact: Record<Impact, ImpactStatus>
  coverage_ratio: number
  display_state: DisplayState
  hazard_check: HazardCheck
  breakdown: Record<string, unknown>
}

/**
 * 浸水深の階級：1=0.5m未満 2=0.5〜3m 3=3〜5m 4=5〜10m 5=10m以上。
 * 0 は「その一帯にデータはあるが、地点に色がない」（想定区域の外とは限らない）。
 * 項目がない種別は、データがない・取得できなかった（未確認）
 */
export type DepthRank = 0 | 1 | 2 | 3 | 4 | 5
export interface PointDepth {
  flood?: DepthRank
  tsunami?: DepthRank
  storm_surge?: DepthRank
  /** 土砂災害：1=警戒区域 2=特別警戒区域 0=地点に色がない */
  landslide?: 0 | 1 | 2
  checked_at: string
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
  /** 施設の地点の想定浸水深などの階級（ハザードマップポータルサイトのタイルの色から読む。DATA_NOTES 14.5）。未取得なら項目自体がない */
  depth?: PointDepth
  amenities: Record<string, AmenityValue>
  scores: Scores
}

export interface MuniFile {
  muni_key: string
  pref_code: string
  pref_name: string
  muni_name: string
  generated_at: string
  /** 算出根拠（scores.breakdown）の中で { $t: 番号 } として参照される文章の表。多くの施設で同じになる式・注記・出典を 1 回だけ持つ */
  breakdown_texts?: unknown[]
  facilities: Facility[]
}

export interface MuniIndexEntry {
  key: string
  name: string
  count: number
  /** 指定避難所の指定がある施設の数と、そのうち地点の想定浸水深（洪水・津波・高潮のいずれか）が 3m 以上の数、土砂災害の区域内の数（DATA_NOTES 14.5） */
  shelters?: number
  deep3?: number
  landslide?: number
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

/** 都道府県の地震被害想定で公表されている市区町村別の避難者数（DATA_NOTES 12.24）。本サービスの推定ではない */
export interface EvacueeEstimatePref {
  publisher: string
  title: string
  published: string
  url: string
  /** 資料の中のページ（PDF の場合） */
  page: number | null
  /** 表示している想定（都道府県全体の避難者数が最も多いもの） */
  scenario: string
  condition: string
  /** 列ごとの時点と区分（例：1日後・避難所） */
  columns: { time: string; kind: string }[]
  total: (number | null)[] | null
  note: string | null
  /** 資料にあるほかの想定の数 */
  other_scenario_count: number
  /** 市区町村コード → 値。値が null のものは、資料で「＊」「－」など数値以外で示されている */
  munis: Record<string, { name: string; values: (number | null)[] }>
  /** 資料にあるが、施設データにない市区町村 */
  not_in_facility_data: string[]
}
export interface EvacueeEstimates {
  description: string
  extracted_at: string
  prefs: Record<string, EvacueeEstimatePref>
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
