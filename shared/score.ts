// スコアの算出（docs/SPEC.md §3）。ビルドスクリプトから使う。DB では算出しない。
//   * 入力が欠けている軸は null（未評価）。0 や平均値で埋めない。
//   * 総合点（単一の数値）は作らない。
//   * 算出根拠は breakdown にすべて残す。
import { HAZARD_KEYS, type AmenityValue, type DisplayState, type EmergencyDesignation, type HazardCheck, type HazardKey, type RoadAccess, type Scores } from './types.ts'

export const SCORE_METHOD_VERSION = 'phase4-5'

/** 想定区域のデータ（ハザードマップポータルサイト）と照合できる災害種別。地震・大規模な火事・火山現象は対応するデータがない */
export const ZONE_CHECKABLE: HazardKey[] = ['flood', 'landslide', 'storm_surge', 'tsunami', 'inland_flood']

/** 軸A：指定されている災害種別と、その地点の想定区域との重なりを見る。点数は出さない（SPEC §3.2） */
export function hazardCheck(designations: Pick<EmergencyDesignation, 'hazards' | 'zone'>[]): HazardCheck {
  const overlap = new Set<HazardKey>()
  const checked = new Set<HazardKey>()
  const designated = new Set<HazardKey>()
  for (const d of designations) {
    for (const k of HAZARD_KEYS) {
      if (!d.hazards[k]) continue
      designated.add(k)
      const z = d.zone?.[k]
      if (z === 'in') overlap.add(k)
      if (z !== undefined) checked.add(k)
    }
  }
  const order = (s: Set<HazardKey>) => HAZARD_KEYS.filter((k) => s.has(k))
  return {
    status: overlap.size > 0 ? 'attention' : checked.size > 0 ? 'no_overlap_found' : 'not_evaluated',
    overlap: order(overlap),
    checked: order(checked),
    unchecked: HAZARD_KEYS.filter((k) => designated.has(k) && !checked.has(k)),
  }
}

export type HabitabilityRule =
  | { kind: 'boolean' }
  | { kind: 'enum'; scores: Record<string, number> }
  | { kind: 'ratio'; max: number }

export interface ScoringDef {
  key: string
  weight: number
  /** 軸C（生活環境）での採点方法。null は軸C の対象外 */
  habitability: HabitabilityRule | null
}

/** 1項目の得点（0〜1）。採点できない値は null */
export function itemScore(rule: HabitabilityRule, value: AmenityValue['value']): number | null {
  if (rule.kind === 'boolean') return typeof value === 'boolean' ? (value ? 1 : 0) : null
  if (rule.kind === 'enum') return typeof value === 'string' && value in rule.scores ? rule.scores[value]! : null
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.min(1, Math.max(0, value / rule.max))
}

const round1 = (n: number) => Math.round(n * 10) / 10

/**
 * 表示状態（SPEC §3.6、DATA_NOTES D-30）。
 * 「要確認（重要）」「要確認」に下げるのは、軸A の重なりと、施設そのものの状態である軸C（生活環境）だけ。
 * 軸D（緊急輸送道路までの距離）は立地の条件で、施設の不備ではないので、表示状態を下げない。
 * 「良好」にするには、軸C・D がどちらも評価済みで 75 以上、かつ軸A で重なりが見つからなかったことを求める。
 */
export function displayState(
  axes: { habitability: number | null; logistics: number | null },
  coverageRatio: number,
  hazardStatus: HazardCheck['status'] = 'not_evaluated',
): DisplayState {
  if (coverageRatio < 0.4) return 'unknown'
  const c = axes.habitability
  const d = axes.logistics
  if (hazardStatus === 'attention' || (c !== null && c < 25)) return 'critical'
  if (c !== null && c < 50) return 'poor'
  if (c !== null && c >= 75 && d !== null && d >= 75 && hazardStatus === 'no_overlap_found') return 'good'
  return 'fair'
}

/** 軸D の距離の点数（SPEC §3.5）。上から順に、最初に当てはまる行を使う */
export const ROAD_DISTANCE_SCORES = [
  { under_m: 500, score: 100 },
  { under_m: 2000, score: 70 },
  { under_m: 5000, score: 40 },
  { under_m: Infinity, score: 10 },
] as const
export const STOCKPILE_ADJUST = 20

/**
 * 軸D：到達性・兵站。緊急輸送道路までの直線距離の点数に、敷地内備蓄の有無で ±20 する。
 * 道路までの距離が未計算、または近くに緊急輸送道路の指定が見つからないなら未評価。備蓄が未確認なら加点も減点もしない（未確認を「なし」として扱わない）。
 */
export function logisticsScore(road: RoadAccess | undefined, stockpile: AmenityValue | undefined) {
  if (!road) return { score: null, breakdown: { status: 'not_evaluated', reason: '最寄りの緊急輸送道路までの距離が未計算（指定避難所の指定がない施設は対象外）' } }
  // 探した範囲に緊急輸送道路の指定が見つからない場合（離島など）は未評価にする。海をはさんだ距離には意味がないため（DATA_NOTES D-26）
  const d = road.distance_m
  if (d === null) {
    return { score: null, breakdown: { status: 'not_evaluated', reason: `${road.searched_m / 1000}km 以内に緊急輸送道路の指定が見つからない（離島など）。いちばん低い点数にはせず、未評価とする`, road } }
  }
  // 施設と同じ陸地に緊急輸送道路の指定がない場合（島など）も未評価にする。海をはさんだ道路までの距離には意味がないため（DATA_NOTES D-29）
  if (road.land === 'no_road') {
    return { score: null, breakdown: { status: 'not_evaluated', reason: '施設と同じ陸地（島など）に緊急輸送道路の指定がない。いちばん低い点数にはせず、未評価とする', road } }
  }
  const base = ROAD_DISTANCE_SCORES.find((r) => d < r.under_m)!.score
  const known = stockpile && stockpile.confidence !== 'disputed' && typeof stockpile.value === 'boolean' ? stockpile.value : null
  const adjust = known === null ? 0 : known ? STOCKPILE_ADJUST : -STOCKPILE_ADJUST
  const score = Math.min(100, Math.max(0, base + adjust))
  return {
    score,
    breakdown: {
      status: 'evaluated',
      formula: '緊急輸送道路までの直線距離の点数（500m 未満=100／2km 未満=70／5km 未満=40／それ以上=10）に、敷地内備蓄があれば +20、なければ −20。0〜100 に収める',
      road,
      distance_score: base,
      stockpile_onsite: known === null ? '未確認（加点も減点もしない）' : known,
      stockpile_adjust: adjust,
      note:
        '距離は直線距離で、実際の道のりではない。高速自動車国道と都市高速道路は除いて測っている。' +
        '道路のデータは 2020 年 3 月時点で、もとの計画図はそれより古い場合がある。位置には誤差があり、その後の指定の変更は反映されていない',
      source: '「国土数値情報（緊急輸送道路データ）」（国土交通省）https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N10-2020.html（2026年11月15日取得）、「国土数値情報（行政区域データ）」（国土交通省）https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-2026.html（2026年11月15日取得）をもとに HinanBase が加工して作成',
      license: '緊急輸送道路データの使用許諾条件は「非商用」。この軸の点数と road の項目は、非商用目的に限り利用できる（国土数値情報ダウンロードサービスコンテンツ利用規約（旧国土情報利用約款準拠版））',
    },
  }
}

/** 軸B：点数は出さない（DATA_NOTES D-22）。公表されている収容人数と、そろっていれば 1 人あたり面積を参考値として残す */
export function capacityReference(persons: AmenityValue | undefined, area: AmenityValue | undefined, toilets?: AmenityValue) {
  const num = (v: AmenityValue | undefined) =>
    v && v.confidence !== 'disputed' && typeof v.value === 'number' && Number.isFinite(v.value) && v.value > 0 ? v.value : null
  const p = num(persons)
  const a = num(area)
  const t = num(toilets)
  return {
    status: 'not_scored',
    reason: '点数は出さない。公開データに有効面積がなく、収容人数の算出の前提も自治体ごとに違うため',
    capacity_persons: p,
    capacity_area_sqm: a,
    per_person_sqm: p !== null && a !== null ? round1(a / p) : null,
    reference_lines_sqm: { conventional: 2.0, sphere: 3.5 },
    // トイレの参照線（スフィア基準：20 人に 1 基）。人数とトイレ総数の両方がそろった施設にだけ出す。点数にはしない
    toilet_total: t,
    toilets_sphere_reference: p !== null && t !== null ? Math.ceil(p / 20) : null,
  }
}

/** 確定設備値などから各軸を算出する。点数を出すのは軸C（生活環境）と軸D（到達性・兵站）。軸A・B は点数を出さない */
export function computeScores(
  amenities: Record<string, AmenityValue>,
  defs: ScoringDef[],
  emergencySites: Pick<EmergencyDesignation, 'hazards' | 'zone'>[] = [],
  road?: RoadAccess,
): Scores {
  const hazard = hazardCheck(emergencySites)
  // 争点中（disputed）の項目は未回答として扱う
  const answered = (key: string) => {
    const v = amenities[key]
    return v && v.confidence !== 'disputed' ? v : undefined
  }
  const totalWeight = defs.reduce((s, d) => s + d.weight, 0)
  const answeredWeight = defs.reduce((s, d) => s + (answered(d.key) ? d.weight : 0), 0)
  const coverage = totalWeight === 0 ? 0 : answeredWeight / totalWeight

  const scored = defs.filter((d) => d.habitability !== null)
  const scoredWeight = scored.reduce((s, d) => s + d.weight, 0)
  let sum = 0
  let scoredAnswered = 0
  const items: Record<string, unknown> = {}
  for (const d of scored) {
    const v = answered(d.key)
    const score = v ? itemScore(d.habitability!, v.value) : null
    if (score !== null) {
      sum += score * d.weight
      scoredAnswered++
    }
    // 未回答の項目も分母から除外しない（得点 0 として効く）ことを、根拠に明示しておく
    items[d.key] = v
      ? { value: v.value, confidence: v.confidence, score, weight: d.weight }
      : { value: null, score: null, weight: d.weight, note: amenities[d.key] ? '争点中のため未回答として扱う' : '未回答' }
  }
  // 採点対象の回答が1つもなければ、軸C は未評価（0 点ではない）
  const habitability = scoredAnswered === 0 || scoredWeight === 0 ? null : round1((sum / scoredWeight) * 100)
  const logistics = logisticsScore(road, amenities.stockpile_onsite)
  const axes = { hazard: null, capacity: null, habitability, logistics: logistics.score }
  const coverageRatio = Math.round(coverage * 1000) / 1000
  return {
    ...axes,
    coverage_ratio: coverageRatio,
    display_state: displayState(axes, coverageRatio, hazard.status),
    hazard_check: hazard,
    breakdown: {
      method_version: SCORE_METHOD_VERSION,
      hazard: {
        ...hazard,
        note:
          '点数は出さない。色が付いていない地点は「区域外」とは限らない（データが未整備の場合がある）。' +
          '照合は約 5m 四方の画素単位。最新かつ詳細な情報は各市町村のハザードマップで確認すること',
        source: '「ハザードマップポータルサイト」を加工して作成',
        uncheckable: HAZARD_KEYS.filter((k) => !ZONE_CHECKABLE.includes(k)),
      },
      capacity: capacityReference(amenities.capacity_persons, amenities.capacity_area_sqm, amenities.toilet_total),
      logistics: logistics.breakdown,
      habitability:
        habitability === null
          ? { status: 'not_evaluated', reason: '採点対象の設備情報なし', scored_weight: scoredWeight }
          : {
              status: 'evaluated',
              formula: 'Σ(項目の得点 × 重み) ÷ Σ(採点対象の全項目の重み) × 100。未回答の項目は分母から除外しない',
              weighted_sum: round1(sum * 100) / 100,
              scored_weight: scoredWeight,
              answered_items: scoredAnswered,
              items,
              excluded: defs.filter((d) => d.habitability === null).map((d) => d.key),
            },
      coverage: {
        formula: 'Σ(回答済み項目の重み) ÷ Σ(全項目の重み)。40% 未満は「未確認」',
        answered_weight: answeredWeight,
        total_weight: totalWeight,
      },
    },
  }
}

/**
 * 算出根拠（breakdown）を小さく保存するための変換。
 * 式・注記・出典のように多くの施設で同じになる文章を、市区町村 JSON の表（breakdown_texts）に 1 回だけ置き、
 * 各施設の breakdown からは { $t: 番号 } で参照する。内容は 1 文字も落とさない（expandBreakdown で元に戻る）。
 * 最寄りの道路（road）は施設の road と同じ内容なので、breakdown からは外し、戻すときに入れ直す。
 * さらに、軸ごとの根拠がまるごと同じ施設が複数ある場合（設備情報がない施設の軸B・C など）は、
 * shared に渡された軸の内容を表に置き、軸そのものを { $t: 番号 } で参照する。
 */
const TABLE_MIN_LENGTH = 20
const TABLE_KEYS = ['uncheckable', 'reference_lines_sqm']
type TextRef = { $t: number }
const isRef = (v: unknown): v is TextRef => typeof v === 'object' && v !== null && typeof (v as TextRef).$t === 'number' && Object.keys(v).length === 1

/** 軸ごとの根拠が同じかどうかを比べるための鍵（road は施設ごとに持つので除く） */
export function axisKey(axis: string, value: unknown): string {
  if (axis === 'logistics' && typeof value === 'object' && value !== null) {
    return `${axis}:${JSON.stringify(Object.fromEntries(Object.entries(value).filter(([k]) => k !== 'road')))}`
  }
  return `${axis}:${JSON.stringify(value)}`
}

export function compactBreakdown(
  breakdown: Record<string, unknown>,
  table: unknown[],
  index: Map<string, number>,
  shared?: Set<string>,
): Record<string, unknown> {
  const put = (v: unknown) => {
    const key = JSON.stringify(v)
    let n = index.get(key)
    if (n === undefined) {
      n = table.push(v) - 1
      index.set(key, n)
    }
    return { $t: n }
  }
  const out: Record<string, unknown> = {}
  for (const [axis, value] of Object.entries(breakdown)) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) { out[axis] = value; continue }
    const o: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      if (axis === 'logistics' && k === 'road') continue
      if ((typeof v === 'string' && v.length >= TABLE_MIN_LENGTH) || TABLE_KEYS.includes(k)) {
        o[k] = put(v)
      } else o[k] = v
    }
    out[axis] = shared?.has(axisKey(axis, value)) ? put(o) : o
  }
  return out
}

/** compactBreakdown で小さくした算出根拠を、元の形に戻す。小さくしていない古いデータはそのまま返る */
export function expandBreakdown(breakdown: Record<string, unknown>, table: unknown[] | undefined, road?: RoadAccess): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [axis, value] of Object.entries(breakdown)) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) { out[axis] = value; continue }
    // 軸がまるごと表にある場合は、先に取り出す
    const axisValue = isRef(value) && table ? (table[value.$t] as Record<string, unknown>) : (value as Record<string, unknown>)
    const o: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(axisValue)) o[k] = isRef(v) && table ? table[v.$t] : v
    if (axis === 'logistics' && road && !('road' in o)) o.road = road
    out[axis] = o
  }
  return out
}
