// スコアの算出（docs/SPEC.md §3）。ビルドスクリプトから使う。DB では算出しない。
//   * 入力が欠けている軸は null（未評価）。0 や平均値で埋めない。
//   * 総合点（単一の数値）は作らない。
//   * 算出根拠は breakdown にすべて残す。
import type { AmenityValue, DisplayState, Scores } from './types.ts'

export const SCORE_METHOD_VERSION = 'phase3-1'

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

export function displayState(
  axes: { hazard: number | null; capacity: number | null; habitability: number | null; logistics: number | null },
  coverageRatio: number,
  hazardMismatch = false,
): DisplayState {
  if (coverageRatio < 0.4) return 'unknown'
  const evaluated = Object.values(axes).filter((v): v is number => v !== null)
  if (hazardMismatch || evaluated.some((v) => v < 25)) return 'critical'
  if (evaluated.some((v) => v < 50)) return 'poor'
  if (evaluated.length === 4 && evaluated.every((v) => v >= 75)) return 'good'
  return 'fair'
}

/** 確定設備値から 4 軸を算出する。Phase 3 時点で算出できるのは軸C（生活環境）だけ */
export function computeScores(amenities: Record<string, AmenityValue>, defs: ScoringDef[]): Scores {
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
  const axes = { hazard: null, capacity: null, habitability, logistics: null }
  const coverageRatio = Math.round(coverage * 1000) / 1000
  return {
    ...axes,
    coverage_ratio: coverageRatio,
    display_state: displayState(axes, coverageRatio),
    breakdown: {
      method_version: SCORE_METHOD_VERSION,
      hazard: { status: 'not_evaluated', reason: 'ハザードデータ未取り込み（Phase 4）' },
      capacity: { status: 'not_evaluated', reason: '収容データ未取り込み（Phase 4）' },
      logistics: { status: 'not_evaluated', reason: '道路データ未取り込み（Phase 4）' },
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
