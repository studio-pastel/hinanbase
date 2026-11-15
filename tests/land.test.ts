import { describe, expect, it } from 'vitest'
import { contains, LandIndex, makePart, MAX_PARTS, type LandPart } from '../scripts/lib/land.ts'

const square = (x: number, y: number, size = 1) => makePart([[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]])

describe('ひと続きの陸地の判定', () => {
  it('面の内側か外側か', () => {
    const p = square(0, 0)
    expect(contains(p, 0.5, 0.5)).toBe(true)
    expect(contains(p, 1.5, 0.5)).toBe(false)
  })
  it('離れた島に道路がなければ no_road。境界を共有する隣の面に道路があれば has_road', () => {
    const land = new LandIndex()
    land.add(square(0, 0)) // 本土の町 A（道路なし）
    land.add(square(1, 0)) // 隣の町 B（道路あり）。A と辺を共有する
    land.add(square(5, 5)) // 島（道路なし）
    const roadAt = (x: number, y: number) => (p: LandPart) => contains(p, x, y)
    expect(land.check(0.5, 0.5, roadAt(1.5, 0.5))).toBe('has_road')
    expect(land.check(1.5, 0.5, roadAt(1.5, 0.5))).toBe('has_road')
    expect(land.check(5.5, 5.5, roadAt(1.5, 0.5))).toBe('no_road')
  })
  it('どの面にも入らない地点は outside（島とは決めつけない）', () => {
    const land = new LandIndex()
    land.add(square(0, 0))
    expect(land.check(3, 3, () => false)).toBe('outside')
  })
  it('道路が見つからないまま面が多数つながる場合は large_land（島とみなさない）', () => {
    const land = new LandIndex()
    for (let i = 0; i <= MAX_PARTS + 5; i++) land.add(square(i, 0))
    expect(land.check(0.5, 0.5, () => false)).toBe('large_land')
  })
})
