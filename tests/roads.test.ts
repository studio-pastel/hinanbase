import { describe, expect, it } from 'vitest'
import { distanceToSegment, RoadIndex, SEARCH_LIMIT_M, type RoadFeature } from '../scripts/lib/roads.ts'

const line = (coords: number[][], type = 3, name = '国道1号'): RoadFeature => ({
  properties: { N10_002: 1, N10_003: type, N10_004: name, N10_008: '2016 03' },
  geometry: { type: 'LineString', coordinates: coords },
})

describe('緊急輸送道路までの直線距離', () => {
  it('線分への垂線の長さ。端の外側では端点までの距離', () => {
    // 緯度 0.001 度は約 111m
    expect(Math.round(distanceToSegment(35.001, 139.5, 139.4, 35, 139.6, 35))).toBe(111)
    // 経度 0.001 度は、北緯 35 度で約 91m
    expect(Math.round(distanceToSegment(35, 139.601, 139.4, 35, 139.6, 35))).toBe(91)
  })
  it('最寄りの道路の名称・区分・資料年月を返す', () => {
    const idx = new RoadIndex()
    idx.add([line([[139.4, 35], [139.6, 35]]), line([[139.4, 35.2], [139.6, 35.2]], 4, '県道2号')])
    expect(idx.nearest(35.003, 139.5)).toEqual({ distance_m: 334, searched_m: SEARCH_LIMIT_M, class: 1, road_type: 3, name: '国道1号', source_ym: '2016 03' })
    expect(idx.nearest(35.19, 139.5).name).toBe('県道2号')
  })
  it('格子をまたいで離れた道路も見つける', () => {
    const idx = new RoadIndex()
    idx.add([line([[139.4, 35], [139.6, 35]])])
    const r = idx.nearest(35.12, 139.5)
    expect(r.distance_m).toBeGreaterThan(13200)
    expect(r.distance_m).toBeLessThan(13500)
  })
  it('高速自動車国道と都市高速道路は対象にしない', () => {
    const idx = new RoadIndex()
    idx.add([line([[139.4, 35], [139.6, 35]], 1, '高速'), line([[139.4, 35.01], [139.6, 35.01]], 2, '都市高速'), line([[139.4, 35.05], [139.6, 35.05]])])
    expect(idx.excluded).toBe(2)
    expect(idx.nearest(35, 139.5).name).toBe('国道1号')
  })
  it('探す範囲に道路がなければ、距離は null（0 や上限値で埋めない）', () => {
    const idx = new RoadIndex()
    idx.add([line([[139.4, 35], [139.6, 35]])])
    expect(idx.nearest(36, 139.5)).toMatchObject({ distance_m: null, searched_m: SEARCH_LIMIT_M, name: null })
  })
})
