// 緊急輸送道路（国土数値情報 N10）の線から、地点に最も近い道路を探す（SPEC §3.5、DATA_NOTES 12.6）
import type { RoadAccess } from '../../shared/types.ts'

export interface RoadFeature {
  properties: { N10_002?: number | null; N10_003?: number | null; N10_004?: string | null; N10_008?: string | null }
  geometry: { type: 'LineString'; coordinates: number[][] } | { type: 'MultiLineString'; coordinates: number[][][] }
}

/** 距離の計算から除く道路種別：高速自動車国道（1）と都市高速道路（2）。近くにあっても出入口がなければ使えないため */
export const EXCLUDED_ROAD_TYPES = [1, 2]
/** これより遠くは探さない。点数は 5km 以上で同じなので、正確な距離は要らない */
export const SEARCH_LIMIT_M = 20000

const CELL = 0.05 // 度。緯度方向に約 5.5km
const RAD = Math.PI / 180
const EARTH_M = 6371000
const M_PER_DEG = EARTH_M * RAD

/** 地点から線分までの距離（m）。近距離なので、緯度に応じて経度を縮めた平面で計算する */
export function distanceToSegment(lat: number, lng: number, x1: number, y1: number, x2: number, y2: number): number {
  const k = Math.cos(lat * RAD)
  const ax = (x1 - lng) * k
  const ay = y1 - lat
  const dx = (x2 - lng) * k - ax
  const dy = y2 - lat - ay
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2))
  return Math.hypot(ax + t * dx, ay + t * dy) * M_PER_DEG
}

export class RoadIndex {
  private seg: number[] = [] // x1, y1, x2, y2, 道路の番号 の繰り返し
  private cells = new Map<string, number[]>()
  private roads: Pick<RoadAccess, 'class' | 'road_type' | 'name' | 'source_ym'>[] = []
  excluded = 0

  get roadCount() { return this.roads.length }
  get segmentCount() { return this.seg.length / 5 }

  add(features: RoadFeature[]) {
    for (const f of features) {
      const p = f.properties
      if (p.N10_003 != null && EXCLUDED_ROAD_TYPES.includes(p.N10_003)) { this.excluded++; continue }
      const road = this.roads.push({ class: p.N10_002 ?? null, road_type: p.N10_003 ?? null, name: p.N10_004?.trim() || null, source_ym: p.N10_008?.trim() || null }) - 1
      const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates
      for (const line of lines) {
        for (let i = 0; i + 1 < line.length; i++) {
          const [x1, y1] = line[i] as [number, number]
          const [x2, y2] = line[i + 1] as [number, number]
          const id = this.seg.length / 5
          this.seg.push(x1, y1, x2, y2, road)
          // 線分がかかる格子すべてに登録する
          for (let cx = Math.floor(Math.min(x1, x2) / CELL); cx <= Math.floor(Math.max(x1, x2) / CELL); cx++) {
            for (let cy = Math.floor(Math.min(y1, y2) / CELL); cy <= Math.floor(Math.max(y1, y2) / CELL); cy++) {
              const key = `${cx},${cy}`
              const list = this.cells.get(key)
              if (list) list.push(id)
              else this.cells.set(key, [id])
            }
          }
        }
      }
    }
  }

  /** 最寄りの道路。SEARCH_LIMIT_M の範囲になければ distance_m は null */
  nearest(lat: number, lng: number): RoadAccess {
    const cx = Math.floor(lng / CELL)
    const cy = Math.floor(lat / CELL)
    // 格子 1 つ分の幅（m）。経度方向のほうが短い
    const cellM = CELL * M_PER_DEG * Math.cos(lat * RAD)
    let best = Infinity
    let bestRoad = -1
    const maxRing = Math.ceil(SEARCH_LIMIT_M / cellM) + 1
    for (let r = 0; r <= maxRing; r++) {
      // 外周の格子だけを新しく調べる
      for (let x = cx - r; x <= cx + r; x++) {
        for (let y = cy - r; y <= cy + r; y++) {
          if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== r) continue
          for (const id of this.cells.get(`${x},${y}`) ?? []) {
            const o = id * 5
            const d = distanceToSegment(lat, lng, this.seg[o]!, this.seg[o + 1]!, this.seg[o + 2]!, this.seg[o + 3]!)
            if (d < best) { best = d; bestRoad = this.seg[o + 4]! }
          }
        }
      }
      // ここまでの格子の外にある道路は、少なくとも r 個分の幅だけ離れている
      if (best <= r * cellM) break
    }
    if (best > SEARCH_LIMIT_M) return { distance_m: null, searched_m: SEARCH_LIMIT_M, class: null, road_type: null, name: null, source_ym: null }
    return { distance_m: Math.round(best), searched_m: SEARCH_LIMIT_M, ...this.roads[bestRoad]! }
  }
}
