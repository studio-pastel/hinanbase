import { describe, expect, it } from 'vitest'
import { mergeRows } from '../scripts/lib/merge.ts'
import { coreName, normalizeName } from '../scripts/lib/normalize.ts'
import { north, row } from './fixtures.ts'

const ids = (r: ReturnType<typeof mergeRows>) => r.clusters.map((c) => c.members.map((m) => m.sourceId))

describe('施設名の正規化', () => {
  it('全角英数字と空白の違いを吸収する', () => {
    expect(normalizeName('第１　小学校 ')).toBe(normalizeName('第1小学校'))
  })
  it('括弧書きを除く', () => {
    expect(coreName('西条小学校（グラウンド）')).toBe('西条小学校')
    expect(coreName('栃木高校【洪水時は２階以上に避難】')).toBe('栃木高校')
  })
})

describe('同一施設の統合（DATA_NOTES 7.3）', () => {
  it('R1：住所グループと施設名が同じで 200m 未満なら統合し、避難所を代表にする', () => {
    const r = mergeRows([row('E0110000001202', 'もみじ台中学校'), row('E0110000001111', 'もみじ台中学校', north(50))])
    expect(ids(r)).toEqual([['E0110000001111', 'E0110000001202']])
    expect(r.clusters[0]!.rules).toEqual(['R1'])
    expect(r.candidates).toEqual([])
  })

  it('R3：施設名が同じでも 200m 以上離れていれば統合せず、候補に出す', () => {
    const r = mergeRows([row('E0110000001111', '公民館'), row('E0110000001201', '公民館', north(300))])
    expect(r.clusters).toHaveLength(2)
    expect(r.candidates.map((c) => c.rule)).toEqual(['R3'])
    expect(r.candidates[0]!.distance_m).toBeGreaterThanOrEqual(200)
  })

  it('R2：括弧書きを除いた名前が包含関係なら統合する', () => {
    const r = mergeRows([row('E0110000001111', '西条小学校'), row('E0110000001201', '西条小学校（グラウンド）', north(60))])
    expect(r.clusters).toHaveLength(1)
    expect(r.clusters[0]!.rules).toEqual(['R2'])
  })

  it('R4：包含関係でも 200m 以上離れていれば候補に出す', () => {
    const r = mergeRows([row('E0110000001111', '西条小学校'), row('E0110000001201', '西条小学校グラウンド', north(400))])
    expect(r.clusters).toHaveLength(2)
    expect(r.candidates.map((c) => c.rule)).toEqual(['R4'])
  })

  it('同じ住所でも施設名が無関係なら別の施設にする', () => {
    const r = mergeRows([
      row('E0110000238111', '大通・西会館'), row('E0110000238112', '二条小学校'), row('E0110000238201', '二条小学校'),
    ])
    expect(ids(r)).toEqual([['E0110000238111'], ['E0110000238112', 'E0110000238201']])
  })

  it('住所グループが違えば、名前が同じでも統合しない。同じ市区町村なら R5 の候補に出す', () => {
    const r = mergeRows([row('E0110000414111', '豊滝除雪ステーション'), row('E0110000420201', '豊滝除雪ステーション')])
    expect(r.clusters).toHaveLength(2)
    expect(r.candidates.map((c) => c.rule)).toEqual(['R5'])
  })

  it('一般の避難所・受入対象者限定の避難所・緊急避難場所の3行を1施設にまとめ、行は畳まない', () => {
    const r = mergeRows([
      row('E0120600010201', 'おんべつ学園'), row('E0120600010121', 'おんべつ学園'), row('E0120600010111', 'おんべつ学園'),
    ])
    expect(ids(r)).toEqual([['E0120600010111', 'E0120600010121', 'E0120600010201']])
    expect(r.clusters[0]!.rules).toEqual(['R1', 'SAME_NAME'])
  })

  it('すべての行が、ちょうど1つの施設に入る', () => {
    const rows = [
      row('E0110000001111', 'A小学校'), row('E0110000001201', 'A小学校'), row('E0110000001202', 'A小学校（校庭）'),
      row('E0110000002201', '公園'), row('E0110000003121', '福祉センター'),
    ]
    const out = mergeRows(rows).clusters.flatMap((c) => c.members.map((m) => m.sourceId)).sort()
    expect(out).toEqual(rows.map((x) => x.sourceId).sort())
  })
})
