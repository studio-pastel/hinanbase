import { describe, expect, it } from 'vitest'
import { mergeRows } from '../scripts/lib/merge.ts'
import { assignFacilityIds, formatRegistry, parseRegistry } from '../scripts/lib/registry.ts'
import { row } from './fixtures.ts'

describe('facility_id の対応表（DATA_NOTES D-2、D-3）', () => {
  it('初回は代表の共通ID を facility_id にする', () => {
    const { clusters } = mergeRows([row('E0110000001202', '中学校'), row('E0110000001111', '中学校')])
    const a = assignFacilityIds(clusters, [], '2026-11-11')
    expect(a.ids).toEqual(['E0110000001111'])
    expect(a.registry.map((e) => [e.source_id, e.facility_id])).toEqual([
      ['E0110000001111', 'E0110000001111'], ['E0110000001202', 'E0110000001111'],
    ])
    expect(a.minted).toBe(1)
  })

  it('同じデータを再取り込みしても何も変わらない', () => {
    const { clusters } = mergeRows([row('E0110000001202', '中学校'), row('E0110000001111', '中学校'), row('E0110000002201', '公園')])
    const first = assignFacilityIds(clusters, [], '2026-11-11')
    const second = assignFacilityIds(clusters, first.registry, '2026-11-11')
    expect(second.ids).toEqual(first.ids)
    expect(formatRegistry(second.registry)).toBe(formatRegistry(first.registry))
    expect(second.minted).toBe(0)
  })

  it('緊急避難場所だけだった施設に避難所の指定が付いても、facility_id は変わらない', () => {
    const before = mergeRows([row('E0110000001201', '中学校')])
    const first = assignFacilityIds(before.clusters, [], '2026-11-11')
    expect(first.ids).toEqual(['E0110000001201'])
    // 次回の取得で避難所の行が増え、規則上の代表は避難所側に変わる
    const after = mergeRows([row('E0110000001201', '中学校'), row('E0110000001111', '中学校')])
    expect(after.clusters[0]!.members[0]!.sourceId).toBe('E0110000001111')
    const second = assignFacilityIds(after.clusters, first.registry, '2027-02-01')
    expect(second.ids).toEqual(['E0110000001201'])
    expect(second.remapped).toEqual([])
    const added = second.registry.find((e) => e.source_id === 'E0110000001111')!
    expect(added).toMatchObject({ facility_id: 'E0110000001201', first_seen: '2027-02-01', last_seen: '2027-02-01' })
  })

  it('公的データから消えた施設は対応表から消さず、deprecated として報告する', () => {
    const first = assignFacilityIds(mergeRows([row('E0110000001111', 'A'), row('E0110000002111', 'B')]).clusters, [], '2026-11-11')
    const second = assignFacilityIds(mergeRows([row('E0110000001111', 'A')]).clusters, first.registry, '2027-02-01')
    expect(second.deprecated).toEqual(['E0110000002111'])
    expect(second.registry).toHaveLength(2)
    expect(second.registry.find((e) => e.source_id === 'E0110000002111')!.last_seen).toBe('2026-11-11')
  })

  it('1つの施設が2つに分かれたら、facility_id と同じ共通ID を持つ側が ID を保つ', () => {
    const first = assignFacilityIds(mergeRows([row('E0110000001111', '公民館'), row('E0110000001201', '公民館')]).clusters, [], '2026-11-11')
    const split = mergeRows([row('E0110000001111', '公民館'), row('E0110000001201', '運動公園')])
    const second = assignFacilityIds(split.clusters, first.registry, '2027-02-01')
    expect(second.ids).toEqual(['E0110000001111', 'E0110000001201'])
    expect(second.remapped).toEqual([{ source_id: 'E0110000001201', from: 'E0110000001111', to: 'E0110000001201' }])
  })

  it('対応表のファイルを書いて読み戻せる', () => {
    const a = assignFacilityIds(mergeRows([row('E0110000001111', 'A')]).clusters, [], '2026-11-11')
    expect(parseRegistry(formatRegistry(a.registry))).toEqual(a.registry)
  })
})
