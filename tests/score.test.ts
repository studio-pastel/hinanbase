import { describe, expect, it } from 'vitest'
import defsJson from '../config/amenity-defs.json' with { type: 'json' }
import { computeScores, displayState, itemStatus, perspectiveStatus, type ScoringDef } from '../shared/score.ts'
import type { AmenityValue } from '../shared/types.ts'
import type { MapFilter } from '../src/lib/map/MapAdapter.ts'

const defs = defsJson.amenities as unknown as ScoringDef[]
const v = (value: AmenityValue['value'], confidence: AmenityValue['confidence'] = 'reported'): AmenityValue => ({
  value, confidence, observed_at: '2026-11-01', evidence_count: 1,
})

const LIFE = ['aircon_main_hall', 'heating_main_hall', 'toilet_total', 'water_supply', 'power_backup', 'solar_battery', 'bed_kit', 'toilet_water_outage']
const lifeOk = (): Record<string, AmenityValue> => ({
  aircon_main_hall: v('full'), heating_main_hall: v('full'), toilet_total: v(10), capacity_persons: v(300),
  water_supply: v(true), power_backup: v('full'), solar_battery: v(false), bed_kit: v('sufficient'), toilet_water_outage: v(true),
})
const allOk = (): Record<string, AmenityValue> => ({
  ...lifeOk(), insulation: v(true), shower: v('shower'), stockpile_onsite: v(true), kitchen: v(true),
  toilet_western_ratio: v(80), toilet_multipurpose: v(true), elevator: v(false), step_free_entry: v(true),
  wifi: v(true), partition_kit: v('sufficient'), pet_accepted: v('outdoor_only'), changing_nursing_room: v(true), toilet_lighting_security: v(true),
})

describe('設備項目マスタの判定規則', () => {
  it('参考値以外のすべての項目に、観点と判定規則がある', () => {
    for (const d of defs) {
      if (d.impact === null) expect(d.status_rule).toBeUndefined()
      else expect(['life', 'health', 'dignity', 'access']).toContain(d.impact)
    }
    expect(defs.filter((d) => d.impact === 'life').map((d) => d.key).sort()).toEqual([...LIFE].sort())
  })
  it('選択肢の判定規則は、マスタの選択肢だけを使う', () => {
    for (const d of defsJson.amenities) {
      const r = (d as { status_rule?: { kind: string; short?: unknown[]; ok?: unknown[]; neutral?: unknown[] } }).status_rule
      if (r?.kind !== 'enum') continue
      const allowed = d.value_type === 'boolean' ? [true, false] : d.enum_options!
      for (const x of [...(r.short ?? []), ...(r.ok ?? []), ...(r.neutral ?? [])]) expect(allowed).toContain(x)
    }
  })
})

describe('項目の状態', () => {
  const def = (key: string) => defs.find((d) => d.key === key)!
  it('未確認の値を「なし」として扱わない', () => {
    expect(itemStatus(def('aircon_main_hall'), {})).toBe('unknown')
    expect(itemStatus(def('aircon_main_hall'), { aircon_main_hall: v('none') })).toBe('short')
    expect(itemStatus(def('aircon_main_hall'), { aircon_main_hall: v('spot_only') })).toBe('limited')
    expect(itemStatus(def('aircon_main_hall'), { aircon_main_hall: v('present') })).toBe('ok')
  })
  it('争点中の値は未確認', () => {
    expect(itemStatus(def('water_supply'), { water_supply: v(false, 'disputed') })).toBe('unknown')
  })
  it('非常用発電機がなくても、太陽光＋蓄電池があれば不足にしない', () => {
    expect(itemStatus(def('power_backup'), { power_backup: v('none') })).toBe('short')
    expect(itemStatus(def('power_backup'), { power_backup: v('none'), solar_battery: v(true) })).toBe('limited')
  })
  it('エレベーターがないことだけでは判定に数えない', () => {
    expect(itemStatus(def('elevator'), { elevator: v(false) })).toBe('neutral')
  })
  it('トイレの数は想定収容人数とあわせて判定する（50 人に 1 基）', () => {
    expect(itemStatus(def('toilet_total'), { toilet_total: v(10) })).toBe('unknown')
    expect(itemStatus(def('toilet_total'), { toilet_total: v(10), capacity_persons: v(500) })).toBe('ok')
    expect(itemStatus(def('toilet_total'), { toilet_total: v(10), capacity_persons: v(501) })).toBe('short')
  })
  it('洋式が 1 つもなければ不足', () => {
    expect(itemStatus(def('toilet_western_ratio'), { toilet_western_ratio: v(0) })).toBe('short')
    expect(itemStatus(def('toilet_western_ratio'), { toilet_western_ratio: v(30) })).toBe('ok')
  })
})

describe('観点ごとの状態', () => {
  it('1 つでも不足なら不足。他の項目の充足で打ち消さない', () => {
    expect(perspectiveStatus(['ok', 'ok', 'short'])).toBe('short')
    expect(perspectiveStatus(['short', 'unknown'])).toBe('short')
  })
  it('確認できていない項目が残れば未確認。判定に数えない項目は除く', () => {
    expect(perspectiveStatus(['ok', 'unknown'])).toBe('unknown')
    expect(perspectiveStatus(['ok', 'neutral'])).toBe('ok')
    expect(perspectiveStatus(['ok', 'limited'])).toBe('limited')
    expect(perspectiveStatus([])).toBe('unknown')
  })
})

describe('設備の算出', () => {
  it('設備情報がなければ、観点はすべて未確認で「未確認」。0 点にしない', () => {
    const s = computeScores({}, defs)
    expect([s.hazard, s.capacity, s.logistics]).toEqual([null, null, null])
    expect(s.impact).toEqual({ life: 'unknown', health: 'unknown', dignity: 'unknown', access: 'unknown' })
    expect(s.coverage_ratio).toBe(0)
    expect(s.display_state).toBe('unknown')
    expect(s).not.toHaveProperty('total')
  })
  it('命にかかわる設備の不足が 1 つ確定すれば、ほかが未確認でも「要確認（重要）」', () => {
    const s = computeScores({ aircon_main_hall: v('none') }, defs)
    expect(s.impact.life).toBe('short')
    expect(s.display_state).toBe('critical')
  })
  it('冷房があるだけでは「未確認」のまま', () => {
    expect(computeScores({ aircon_main_hall: v('present') }, defs).display_state).toBe('unknown')
  })
  it('命にかかわる設備がすべて確認済みで不足なしなら「概ね良好」。健康などの不足は「要確認」', () => {
    expect(computeScores(lifeOk(), defs).display_state).toBe('fair')
    expect(computeScores({ ...lifeOk(), shower: v('none') }, defs).display_state).toBe('poor')
  })
  it('全項目が充足なら 4 観点とも充足。道路の点数がなければ「良好」にはしない', () => {
    const s = computeScores(allOk(), defs)
    expect(s.impact).toEqual({ life: 'ok', health: 'ok', dignity: 'ok', access: 'ok' })
    expect(s.display_state).toBe('fair')
  })
  it('命にかかわる設備が未確認のまま健康の不足だけ分かっても「要確認」', () => {
    expect(computeScores({ shower: v('none') }, defs).display_state).toBe('poor')
  })
  it('算出根拠を breakdown に残す（項目ごとの状態・季節・出典）', () => {
    const src = { title: 't', publisher: 'p', url: 'https://example.jp', as_of: '2026-05-01', how: 'h' }
    const s = computeScores({ aircon_main_hall: { ...v('none', 'official'), source: src } }, defs)
    const life = (s.breakdown.impact as { perspectives: Record<string, { status: string; items: Record<string, { status: string; season?: string; source?: unknown }> }> }).perspectives.life!
    expect(s.breakdown.method_version).toBe('impact-1')
    expect(life.status).toBe('short')
    expect(life.items.aircon_main_hall).toMatchObject({ status: 'short', season: 'summer', source: src })
    expect(life.items.water_supply!.status).toBe('unknown')
  })
})

describe('表示状態', () => {
  const all = (x: 'ok' | 'unknown' | 'limited' | 'short') => ({ life: x, health: x, dignity: x, access: x })
  it('「良好」は 4 観点すべて充足、重なりなし、道路の点数 75 以上の場合だけ', () => {
    expect(displayState(all('ok'), 80, 'no_overlap_found')).toBe('good')
    expect(displayState(all('ok'), 70, 'no_overlap_found')).toBe('fair')
    expect(displayState(all('ok'), 80, 'not_evaluated')).toBe('fair')
    expect(displayState({ ...all('ok'), access: 'limited' }, 80, 'no_overlap_found')).toBe('fair')
  })
  it('想定区域との重なりは、命にかかわる設備が確認済みのときだけ「要確認（重要）」にする', () => {
    expect(displayState(all('ok'), 80, 'attention')).toBe('critical')
    expect(displayState(all('unknown'), null, 'attention')).toBe('unknown')
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
  it('同じ陸地に緊急輸送道路の指定がない（島など）なら未評価。大きな陸地や判定できない場合は点数を出す', () => {
    expect(logisticsScore({ ...road(8000), land: 'no_road' }, undefined).score).toBeNull()
    expect(logisticsScore({ ...road(8000), land: 'has_road' }, undefined).score).toBe(10)
    expect(logisticsScore({ ...road(8000), land: 'large_land' }, undefined).score).toBe(10)
    expect(logisticsScore({ ...road(8000), land: 'outside' }, undefined).score).toBe(10)
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
    // トイレの参照線（20 人に 1 基）も、人数とトイレ総数がそろったときだけ
    expect(capacityReference(v(410), undefined, v(12))).toMatchObject({ toilet_total: 12, toilets_sphere_reference: 21 })
    expect(capacityReference(v(410), undefined).toilets_sphere_reference).toBeNull()
    expect(capacityReference(undefined, undefined, v(12)).toilets_sphere_reference).toBeNull()
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
  it('軸A の点数は常に null。重なりがあり、命にかかわる設備が確認済みなら「要確認（重要）」', () => {
    const s = computeScores(lifeOk(), defs, [{ hazards: { ...none, flood: true }, zone: { flood: 'in' } }])
    expect(s.hazard).toBeNull()
    expect(s.display_state).toBe('critical')
    expect(computeScores({}, defs, [{ hazards: { ...none, flood: true }, zone: { flood: 'in' } }]).display_state).toBe('unknown')
  })
  it('末尾に余分なデータが付いたタイルも読む。画像でないデータは読めないものとして扱う（止まらない）', async () => {
    const { PNG } = await import('pngjs')
    const { readPng } = await import('../scripts/fetch-hazards.ts')
    const png = new PNG({ width: 2, height: 2 })
    png.data.fill(255)
    const buf = PNG.sync.write(png)
    expect(readPng(buf)?.width).toBe(2)
    expect(readPng(Buffer.concat([buf, Buffer.from('extra')]))?.data[3]).toBe(255)
    expect(readPng(Buffer.from('<html>error</html>'))).toBeUndefined()
  })
  it('緯度経度からタイル番号と画素の位置を求める', () => {
    expect(tileOf(35.6727, 139.8171, 15)).toEqual({ x: 29110, y: 12904, px: 118, py: 70 })
    expect(tileOf(35.6727, 139.8171, 10)).toMatchObject({ x: 909, y: 403 })
  })
})

describe('算出根拠を小さく保存する', async () => {
  const { compactBreakdown, expandBreakdown } = await import('../shared/score.ts')
  const road = { distance_m: 300, searched_m: 20000, class: 1, road_type: 3, name: '国道4号', source_ym: '2016 03' }
  const none = { flood: false, landslide: false, storm_surge: false, earthquake: false, tsunami: false, fire: false, inland_flood: false, volcano: false }
  const full = computeScores({ aircon_main_hall: v('partial'), stockpile_onsite: v(true) }, defs, [{ hazards: { ...none, flood: true }, zone: { flood: 'in' } }], road)

  it('小さくしてから戻すと、元の根拠と 1 文字も違わない', () => {
    const table: unknown[] = []
    const compact = compactBreakdown(full.breakdown, table, new Map())
    expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify(full.breakdown).length)
    expect(expandBreakdown(compact, table, road)).toEqual(full.breakdown)
  })
  it('同じ文章は表に 1 回だけ入る', () => {
    const table: unknown[] = []
    const index = new Map<string, number>()
    compactBreakdown(full.breakdown, table, index)
    const n = table.length
    compactBreakdown(full.breakdown, table, index)
    expect(table).toHaveLength(n)
  })
  it('軸の根拠がまるごと同じ施設どうしは、軸ごと表に置く。戻せば元どおり', async () => {
    const { axisKey } = await import('../shared/score.ts')
    const table: unknown[] = []
    const shared = new Set(Object.entries(full.breakdown).filter(([, x]) => typeof x === 'object').map(([a, x]) => axisKey(a, x)))
    const compact = compactBreakdown(full.breakdown, table, new Map(), shared)
    expect(compact.capacity).toEqual({ $t: expect.any(Number) })
    expect(compact.logistics).toEqual({ $t: expect.any(Number) })
    expect(expandBreakdown(compact, table, road)).toEqual(full.breakdown)
    // 道路が違う施設でも、道路以外が同じなら同じ鍵になる
    expect(axisKey('logistics', { a: 1, road: { distance_m: 1 } })).toBe(axisKey('logistics', { a: 1, road: { distance_m: 2 } }))
  })
  it('小さくしていない古いデータは、そのまま表示できる', () => {
    expect(expandBreakdown(full.breakdown, undefined, road)).toEqual(full.breakdown)
  })
})
