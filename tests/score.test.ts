import { describe, expect, it } from 'vitest'
import defsJson from '../config/amenity-defs.json' with { type: 'json' }
import { computeScores, displayState, itemScore, type HabitabilityRule, type ScoringDef } from '../shared/score.ts'
import type { AmenityValue } from '../shared/types.ts'
import type { MapFilter } from '../src/lib/map/MapAdapter.ts'

const defs = defsJson.amenities as ScoringDef[]
const v = (value: AmenityValue['value'], confidence: AmenityValue['confidence'] = 'reported'): AmenityValue => ({
  value, confidence, observed_at: '2026-11-01', evidence_count: 1,
})

describe('設備項目マスタの採点表', () => {
  it('軸C の対象は 15 項目。エレベーターと数量の 5 項目は対象外', () => {
    expect(defs.filter((d) => d.habitability !== null)).toHaveLength(15)
    const excluded = defs.filter((d) => d.habitability === null).map((d) => d.key).sort()
    expect(excluded).toEqual(['capacity_area_sqm', 'capacity_persons', 'elevator', 'power_duration_h', 'stockpile_days', 'toilet_total'])
  })
  it('選択肢の採点表は、マスタの選択肢と過不足なく対応する', () => {
    for (const d of defsJson.amenities) {
      const rule = d.habitability as HabitabilityRule | null
      if (rule?.kind === 'enum') expect(Object.keys(rule.scores).sort()).toEqual([...d.enum_options!].sort())
    }
  })
})

describe('項目の得点', () => {
  it('あり／なし、選択肢、割合', () => {
    expect(itemScore({ kind: 'boolean' }, true)).toBe(1)
    expect(itemScore({ kind: 'boolean' }, false)).toBe(0)
    expect(itemScore({ kind: 'enum', scores: { none: 0, full: 1 } }, 'full')).toBe(1)
    expect(itemScore({ kind: 'ratio', max: 100 }, 60)).toBe(0.6)
    expect(itemScore({ kind: 'ratio', max: 100 }, 250)).toBe(1)
  })
  it('型の合わない値は採点しない', () => {
    expect(itemScore({ kind: 'boolean' }, 'yes')).toBeNull()
    expect(itemScore({ kind: 'enum', scores: { none: 0 } }, 'other')).toBeNull()
  })
})

describe('4軸の算出', () => {
  it('設備情報がなければ、4軸とも未評価（null）で「未確認」。0 点にしない', () => {
    const s = computeScores({}, defs)
    expect([s.hazard, s.capacity, s.habitability, s.logistics]).toEqual([null, null, null, null])
    expect(s.coverage_ratio).toBe(0)
    expect(s.display_state).toBe('unknown')
    expect(s).not.toHaveProperty('total')
  })

  it('冷房「全体」だけ分かっている施設：軸C は 1 ÷ 15 = 6.7 点。回答率が低いので「未確認」のまま', () => {
    const s = computeScores({ aircon_main_hall: v('full') }, defs)
    expect(s.habitability).toBe(6.7)
    expect(s.coverage_ratio).toBe(0.048)
    expect(s.display_state).toBe('unknown')
  })

  it('エレベーターは点数に影響しないが、回答率には数える', () => {
    const base = computeScores({ aircon_main_hall: v('full') }, defs)
    const withElevator = computeScores({ aircon_main_hall: v('full'), elevator: v(false) }, defs)
    expect(withElevator.habitability).toBe(base.habitability)
    expect(withElevator.coverage_ratio).toBeGreaterThan(base.coverage_ratio)
  })

  it('採点対象外の項目しか分からなければ、軸C は未評価', () => {
    expect(computeScores({ elevator: v(true), capacity_persons: v(300) }, defs).habitability).toBeNull()
  })

  it('9 項目がすべて満点なら 60 点で「一部充足」。4 軸そろわないので「充足」にはならない', () => {
    const keys = ['aircon_main_hall', 'heating_main_hall', 'insulation', 'toilet_multipurpose', 'water_supply', 'solar_battery', 'step_free_entry', 'wifi', 'kitchen']
    const a = Object.fromEntries(keys.map((k) => [k, v(k.endsWith('main_hall') ? 'full' : true)]))
    const s = computeScores(a, defs)
    expect(s.habitability).toBe(60)
    expect(s.coverage_ratio).toBe(0.429)
    expect(s.display_state).toBe('fair')
  })

  it('9 項目そろっていて設備がほとんどなければ「要確認（重要）」', () => {
    const keys = ['aircon_main_hall', 'heating_main_hall', 'insulation', 'toilet_multipurpose', 'water_supply', 'solar_battery', 'step_free_entry', 'wifi', 'kitchen']
    const a = Object.fromEntries(keys.map((k) => [k, v(k.endsWith('main_hall') ? 'none' : false)]))
    const s = computeScores({ ...a, wifi: v(true) }, defs)
    expect(s.habitability).toBe(6.7)
    expect(s.display_state).toBe('critical')
  })

  it('争点中の項目は未回答として扱う', () => {
    const s = computeScores({ aircon_main_hall: v('full', 'disputed'), wifi: v(true) }, defs)
    expect(s.habitability).toBe(6.7)
    expect(s.coverage_ratio).toBe(0.048)
  })

  it('算出根拠を breakdown に残す', () => {
    const s = computeScores({ aircon_main_hall: v('partial'), wifi: v(true) }, defs)
    const h = s.breakdown.habitability as { items: Record<string, { score: number | null }>; excluded: string[] }
    expect(s.breakdown.method_version).toBe('phase3-1')
    expect(h.items.aircon_main_hall!.score).toBe(0.67)
    expect(h.items.shower!.score).toBeNull()
    expect(h.excluded).toContain('elevator')
  })
})

describe('表示状態', () => {
  it('回答率 40% 未満は、点数にかかわらず未確認', () => {
    expect(displayState({ hazard: null, capacity: null, habitability: 10, logistics: null }, 0.39)).toBe('unknown')
  })
  it('評価済みの軸で判定する', () => {
    const ax = (h: number) => ({ hazard: null, capacity: null, habitability: h, logistics: null })
    expect(displayState(ax(24.9), 0.5)).toBe('critical')
    expect(displayState(ax(49.9), 0.5)).toBe('poor')
    expect(displayState(ax(90), 0.5)).toBe('fair')
    expect(displayState({ hazard: 80, capacity: 80, habitability: 80, logistics: 80 }, 0.9)).toBe('good')
    expect(displayState({ hazard: 80, capacity: 80, habitability: 80, logistics: 80 }, 0.9, true)).toBe('critical')
  })
})

describe('まとめ表示の件数に使う属性', async () => {
  const { clusterCountAttributes, isClusterCountUnavailable } = await import('../src/lib/map/MapAdapter.ts')
  const all = ['unknown', 'critical', 'poor', 'fair', 'good'] as const
  const base: MapFilter = { kind: 'all', hazard: 'all', states: [...all], ac: 'all' }
  it('条件なしなら全件数、条件が1つならその属性の合計', () => {
    expect(clusterCountAttributes(base)).toEqual([])
    expect(clusterCountAttributes({ ...base, ac: 'none' })).toEqual(['acn'])
    expect(clusterCountAttributes({ ...base, kind: 'shelter' })).toEqual(['ns'])
    expect(clusterCountAttributes({ ...base, kind: 'emergency', hazard: 'tsunami' })).toEqual(['h4'])
    expect(clusterCountAttributes({ ...base, states: ['critical', 'poor'] })).toEqual([['s1', 's2']])
  })
  it('条件が2つ以上重なると、正確な件数は出せない', () => {
    expect(isClusterCountUnavailable({ ...base, ac: 'none' })).toBe(false)
    expect(isClusterCountUnavailable({ ...base, ac: 'none', kind: 'shelter' })).toBe(true)
    expect(isClusterCountUnavailable({ ...base, kind: 'shelter', hazard: 'flood' })).toBe(true)
  })
})
