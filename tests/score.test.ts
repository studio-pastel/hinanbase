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
    expect(s.breakdown.method_version).toBe('phase4-3')
    expect(h.items.aircon_main_hall!.score).toBe(0.67)
    expect(h.items.shower!.score).toBeNull()
    expect(h.excluded).toContain('elevator')
  })
})

describe('表示状態', () => {
  it('回答率 40% 未満は、点数にかかわらず未確認', () => {
    expect(displayState({ habitability: 10, logistics: null }, 0.39)).toBe('unknown')
  })
  it('評価済みの軸で判定する', () => {
    const ax = (h: number) => ({ habitability: h, logistics: null })
    expect(displayState(ax(24.9), 0.5)).toBe('critical')
    expect(displayState(ax(49.9), 0.5)).toBe('poor')
    expect(displayState(ax(90), 0.5)).toBe('fair')
    expect(displayState({ habitability: 90, logistics: 40 }, 0.5)).toBe('poor')
  })
  it('「良好」は軸C・D が 75 以上で、軸A で重なりが見つからなかった場合だけ（軸B は条件にしない）', () => {
    const ok = { habitability: 80, logistics: 80 }
    expect(displayState(ok, 0.9, 'no_overlap_found')).toBe('good')
    expect(displayState(ok, 0.9, 'not_evaluated')).toBe('fair')
    expect(displayState(ok, 0.9, 'attention')).toBe('critical')
    expect(displayState({ habitability: 80, logistics: 70 }, 0.9, 'no_overlap_found')).toBe('fair')
    expect(displayState({ habitability: 80, logistics: null }, 0.9, 'no_overlap_found')).toBe('fair')
  })
})

describe('軸D：緊急輸送道路までの距離と敷地内備蓄', async () => {
  const { logisticsScore, capacityReference } = await import('../shared/score.ts')
  const road = (distance_m: number | null) => ({ distance_m, searched_m: 20000, class: 1, road_type: 3, name: '国道4号', source_ym: '2016 03' })
  it('距離の区分', () => {
    expect(logisticsScore(road(499), undefined).score).toBe(100)
    expect(logisticsScore(road(500), undefined).score).toBe(70)
    expect(logisticsScore(road(1999), undefined).score).toBe(70)
    expect(logisticsScore(road(4999), undefined).score).toBe(40)
    expect(logisticsScore(road(5000), undefined).score).toBe(10)
  })
  it('敷地内備蓄があれば +20、なければ −20。0〜100 に収める', () => {
    expect(logisticsScore(road(1000), v(true)).score).toBe(90)
    expect(logisticsScore(road(1000), v(false)).score).toBe(50)
    expect(logisticsScore(road(100), v(true)).score).toBe(100)
    expect(logisticsScore(road(9000), v(false)).score).toBe(0)
  })
  it('備蓄が未確認・争点中なら、加点も減点もしない', () => {
    expect(logisticsScore(road(1000), undefined)).toMatchObject({ score: 70, breakdown: { stockpile_adjust: 0 } })
    expect(logisticsScore(road(1000), v(false, 'disputed')).score).toBe(70)
  })
  it('近くに緊急輸送道路の指定が見つからない（離島など）なら未評価。いちばん低い点数にしない', () => {
    expect(logisticsScore(road(null), v(true))).toMatchObject({ score: null, breakdown: { status: 'not_evaluated' } })
    expect(computeScores({}, defs, [], road(null)).logistics).toBeNull()
  })
  it('距離が未計算なら未評価（0 点ではない）', () => {
    expect(logisticsScore(undefined, v(true)).score).toBeNull()
    expect(computeScores({}, defs).logistics).toBeNull()
    expect(computeScores({}, defs, [], road(300)).logistics).toBe(100)
  })
  it('軸B は点数を出さない。面積と人数がそろえば 1 人あたり面積を参考値として残す', () => {
    const s = computeScores({ capacity_persons: v(400), capacity_area_sqm: v(900) }, defs)
    expect(s.capacity).toBeNull()
    expect(s.breakdown.capacity).toMatchObject({ status: 'not_scored', capacity_persons: 400, per_person_sqm: 2.3 })
    expect(capacityReference(v(400), undefined).per_person_sqm).toBeNull()
    expect(capacityReference(v(0), v(900)).per_person_sqm).toBeNull()
  })
})

describe('まとめ表示の件数に使う属性', async () => {
  const { clusterCountAttributes, isClusterCountUnavailable } = await import('../src/lib/map/MapAdapter.ts')
  const all = ['unknown', 'critical', 'poor', 'fair', 'good'] as const
  const base: MapFilter = { kind: 'all', hazard: 'all', states: [...all], ac: 'all', overlap: 'all' }
  it('条件なしなら全件数、条件が1つならその属性の合計', () => {
    expect(clusterCountAttributes(base)).toEqual([])
    expect(clusterCountAttributes({ ...base, ac: 'none' })).toEqual(['acn'])
    expect(clusterCountAttributes({ ...base, kind: 'shelter' })).toEqual(['ns'])
    expect(clusterCountAttributes({ ...base, overlap: 'only' })).toEqual(['hm'])
    expect(clusterCountAttributes({ ...base, kind: 'emergency', hazard: 'tsunami' })).toEqual(['h4'])
    expect(clusterCountAttributes({ ...base, states: ['critical', 'poor'] })).toEqual([['s1', 's2']])
  })
  it('条件が2つ以上重なると、正確な件数は出せない', () => {
    expect(isClusterCountUnavailable({ ...base, ac: 'none' })).toBe(false)
    expect(isClusterCountUnavailable({ ...base, ac: 'none', kind: 'shelter' })).toBe(true)
    expect(isClusterCountUnavailable({ ...base, overlap: 'only', hazard: 'flood' })).toBe(true)
    expect(isClusterCountUnavailable({ ...base, kind: 'shelter', hazard: 'flood' })).toBe(true)
  })
})

describe('軸A：想定区域との重なり（点数は出さない）', async () => {
  const { hazardCheck } = await import('../shared/score.ts')
  const { tileOf } = await import('../scripts/fetch-hazards.ts')
  const none = { flood: false, landslide: false, storm_surge: false, earthquake: false, tsunami: false, fire: false, inland_flood: false, volcano: false }

  it('指定された種別が区域内なら「要確認の種別がある」', () => {
    const r = hazardCheck([{ hazards: { ...none, flood: true, earthquake: true }, zone: { flood: 'in' } }])
    expect(r).toEqual({ status: 'attention', overlap: ['flood'], checked: ['flood'], unchecked: ['earthquake'] })
  })
  it('色が付いていなければ「確認できる範囲では重なりなし」。適合とはしない', () => {
    const r = hazardCheck([{ hazards: { ...none, flood: true, tsunami: true }, zone: { flood: 'none', tsunami: 'none' } }])
    expect(r.status).toBe('no_overlap_found')
    expect(r.overlap).toEqual([])
  })
  it('照合できない種別（地震・火事・火山）しか指定がなければ「未評価」', () => {
    const r = hazardCheck([{ hazards: { ...none, earthquake: true, fire: true } }])
    expect(r).toEqual({ status: 'not_evaluated', overlap: [], checked: [], unchecked: ['earthquake', 'fire'] })
  })
  it('指定されていない種別が区域内でも、重なりには数えない', () => {
    const r = hazardCheck([{ hazards: { ...none, earthquake: true }, zone: { flood: 'in' } }])
    expect(r.status).toBe('not_evaluated')
  })
  it('建物と校庭など複数の指定は、どれかが区域内なら要確認', () => {
    const r = hazardCheck([
      { hazards: { ...none, flood: true }, zone: { flood: 'none' } },
      { hazards: { ...none, flood: true, storm_surge: true }, zone: { flood: 'in', storm_surge: 'none' } },
    ])
    expect(r).toMatchObject({ status: 'attention', overlap: ['flood'], checked: ['flood', 'storm_surge'] })
  })
  it('軸A の点数は常に null。重なりがあり、設備の回答率が 4 割以上なら「要確認（重要）」', () => {
    const keys = ['aircon_main_hall', 'heating_main_hall', 'insulation', 'toilet_multipurpose', 'water_supply', 'solar_battery', 'step_free_entry', 'wifi', 'kitchen']
    const a = Object.fromEntries(keys.map((k) => [k, v(k.endsWith('main_hall') ? 'full' : true)]))
    const s = computeScores(a, defs, [{ hazards: { ...none, flood: true }, zone: { flood: 'in' } }])
    expect(s.hazard).toBeNull()
    expect(s.habitability).toBe(60)
    expect(s.display_state).toBe('critical')
    expect(computeScores({}, defs, [{ hazards: { ...none, flood: true }, zone: { flood: 'in' } }]).display_state).toBe('unknown')
  })
  it('緯度経度からタイル番号と画素の位置を求める', () => {
    expect(tileOf(35.6727, 139.8171, 15)).toEqual({ x: 29110, y: 12904, px: 118, py: 70 })
    expect(tileOf(35.6727, 139.8171, 10)).toMatchObject({ x: 909, y: 403 })
  })
})
