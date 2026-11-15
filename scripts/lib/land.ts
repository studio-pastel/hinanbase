// 「ひと続きの陸地」の判定（DATA_NOTES 12.12、D-29）。
// 行政区域データ（国土数値情報 N03）は、島ごと・市区町村ごとに別の面になっている。
// 境界の頂点を共有する面どうしを同じ陸地とみなし、施設のある陸地に緊急輸送道路の指定があるかを調べる。

export interface LandPart {
  ring: Float64Array // 外周の x, y の繰り返し（穴は見ない）
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export function makePart(ring: number[][]): LandPart {
  const a = new Float64Array(ring.length * 2)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  ring.forEach(([x, y], i) => {
    a[i * 2] = x!
    a[i * 2 + 1] = y!
    if (x! < minX) minX = x!
    if (x! > maxX) maxX = x!
    if (y! < minY) minY = y!
    if (y! > maxY) maxY = y!
  })
  return { ring: a, minX, minY, maxX, maxY }
}

export function contains(p: LandPart, x: number, y: number): boolean {
  if (x < p.minX || x > p.maxX || y < p.minY || y > p.maxY) return false
  const r = p.ring
  let inside = false
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const xi = r[i]!, yi = r[i + 1]!, xj = r[j]!, yj = r[j + 1]!
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

const CELL = 0.05
const vkey = (x: number, y: number) => `${x.toFixed(6)},${y.toFixed(6)}`

/** 調べる面の数の上限。これを超えて広がる陸地は「大きな陸地（本土など）」として扱い、島とはみなさない */
export const MAX_PARTS = 40

export type LandResult = 'has_road' | 'no_road' | 'large_land' | 'outside'

export class LandIndex {
  private parts: LandPart[] = []
  private cells = new Map<string, number[]>()
  private keys = new Map<number, Set<string>>()

  get size() { return this.parts.length }

  add(part: LandPart) {
    const id = this.parts.push(part) - 1
    for (let cx = Math.floor(part.minX / CELL); cx <= Math.floor(part.maxX / CELL); cx++) {
      for (let cy = Math.floor(part.minY / CELL); cy <= Math.floor(part.maxY / CELL); cy++) {
        const k = `${cx},${cy}`
        const list = this.cells.get(k)
        if (list) list.push(id)
        else this.cells.set(k, [id])
      }
    }
  }

  private candidates(minX: number, minY: number, maxX: number, maxY: number): number[] {
    const out = new Set<number>()
    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
      for (let cy = Math.floor(minY / CELL); cy <= Math.floor(maxY / CELL); cy++) {
        for (const id of this.cells.get(`${cx},${cy}`) ?? []) out.add(id)
      }
    }
    return [...out]
  }

  find(x: number, y: number): number {
    return this.candidates(x, y, x, y).find((id) => contains(this.parts[id]!, x, y)) ?? -1
  }

  private vertexKeys(id: number): Set<string> {
    let s = this.keys.get(id)
    if (!s) {
      s = new Set()
      const r = this.parts[id]!.ring
      for (let i = 0; i < r.length; i += 2) s.add(vkey(r[i]!, r[i + 1]!))
      this.keys.set(id, s)
    }
    return s
  }

  /** 境界の頂点を 1 つでも共有する面（隣の市区町村など、地続きの面） */
  private neighbors(id: number): number[] {
    const p = this.parts[id]!
    const mine = this.vertexKeys(id)
    return this.candidates(p.minX, p.minY, p.maxX, p.maxY).filter((o) => {
      if (o === id) return false
      const r = this.parts[o]!.ring
      for (let i = 0; i < r.length; i += 2) if (mine.has(vkey(r[i]!, r[i + 1]!))) return true
      return false
    })
  }

  /**
   * 地点のある陸地に、道路があるかを調べる。
   * hasRoadIn は、面の中に緊急輸送道路の頂点が 1 つでもあれば true を返す関数。
   */
  check(x: number, y: number, hasRoadIn: (part: LandPart) => boolean): LandResult {
    const start = this.find(x, y)
    if (start < 0) return 'outside'
    const seen = new Set([start])
    const queue = [start]
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      if (hasRoadIn(this.parts[id]!)) return 'has_road'
      for (const n of this.neighbors(id)) {
        if (seen.has(n)) continue
        seen.add(n)
        if (seen.size > MAX_PARTS) return 'large_land'
        queue.push(n)
      }
    }
    return 'no_road'
  }
}
