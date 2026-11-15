import { describe, expect, it } from 'vitest'
import { decodeCsv, looseName, matchCapacity, parseCsv, parsePersons, pickDesignation, readCapacityRows } from '../scripts/lib/capacity.ts'
import type { Facility } from '../shared/types.ts'

const facility = (id: string, name: string, lat: number, lng: number, sourceId = id): Facility => ({
  id, name, address: '', lat, lng,
  designations: { emergency_site: [], shelter: [{ source_id: sourceId, name, restricted: false, target: null, other: null, note: null, lat, lng }] },
  merge_rules: [], amenities: {},
  scores: { hazard: null, capacity: null, habitability: null, logistics: null, coverage_ratio: 0, display_state: 'unknown', hazard_check: { status: 'not_evaluated', overlap: [], checked: [], unchecked: [] }, breakdown: {} },
})

describe('自治体の収容人数 CSV の読み取り', () => {
  it('人数は先頭の数字だけを読む。単位や算出の前提が付いていてもよい', () => {
    expect(parsePersons('1427')).toBe(1427)
    expect(parsePersons('429人')).toBe(429)
    expect(parsePersons('1,350人（3.3平方メートルあたり2人）')).toBe(1350)
    expect(parsePersons('１，４６０人')).toBe(1460)
  })
  it('空欄・0・数字で始まらない値は null（0 人や推定値にしない）', () => {
    expect(parsePersons('')).toBeNull()
    expect(parsePersons('0')).toBeNull()
    expect(parsePersons('-')).toBeNull()
    expect(parsePersons('未定')).toBeNull()
    expect(parsePersons('3.3平方メートルあたり2人')).toBeNull()
  })
  it('引用符の中のカンマと改行を 1 つの値として読む', () => {
    expect(parseCsv('名称,備考\r\n"A,B","1行目\n2行目"\r\n')).toEqual([['名称', '備考'], ['A,B', '1行目\n2行目']])
  })
  it('UTF-8（BOM 付き）を読める', () => {
    expect(decodeCsv(new TextEncoder().encode(`${String.fromCharCode(0xfeff)}名称`))).toBe('名称')
  })
  it('自治体標準の列名と、共通ID 付きの列名のどちらも読む', () => {
    const a = readCapacityRows('名称,緯度,経度,指定避難所との重複,想定収容人数\n北小学校,35.1,135.2,1,"1,200人"\n')!
    expect(a[0]).toEqual({ name: '北小学校', lat: 35.1, lng: 135.2, sourceId: null, persons: 1200, raw: '1,200人', alsoShelter: true })
    const b = readCapacityRows('# 共通ID,施設名,収容人数,緯度,経度\nE2432400003201,東小学校校庭,7670,35.1,136.6\n')!
    expect(b[0]).toMatchObject({ sourceId: 'E2432400003201', persons: 7670, alsoShelter: null })
    expect(readCapacityRows('名称,住所\nA,B\n')).toBeNull()
  })
})

describe('収容人数の行と施設の突き合わせ', () => {
  const fs = [
    facility('E2620900001111', '長岡京市立神足小学校', 34.9230, 135.6970),
    facility('E2620900002111', '松ヶ崎公民館', 34.9300, 135.7000),
    facility('E2620900003111', '中央公園', 34.9400, 135.7100),
    facility('E2620900004111', '中央公園', 34.9900, 135.7600),
  ]
  const r = (name: string, lat: number | null, lng: number | null, sourceId: string | null = null) =>
    ({ name, lat, lng, sourceId, persons: 100, raw: '100', alsoShelter: null })
  it('「〇〇市立」の有無と、ケ・ヶの違いは同じ名称とみなす', () => {
    expect(looseName('長岡京市立神足小学校')).toBe(looseName('神足小学校'))
    expect(looseName('松ケ崎公民館')).toBe(looseName('松ヶ崎公民館'))
  })
  it('共通ID が一致すれば、名称や位置にかかわらず対応づける', () => {
    const { matched } = matchCapacity([r('別の名前', null, null, 'E2620900003111')], fs)
    expect(matched[0]).toMatchObject({ method: 'source_id', facility: { id: 'E2620900003111' } })
  })
  it('名称が一致し、300m 以内なら対応づける。同名が複数あれば近いほう', () => {
    const { matched } = matchCapacity([r('神足小学校', 34.9231, 135.6971), r('中央公園', 34.9899, 135.7601)], fs)
    expect(matched.map((m) => m.facility.id)).toEqual(['E2620900001111', 'E2620900004111'])
    expect(matched[0]!.method).toBe('name_and_location')
  })
  it('名称が一致しても遠ければ対応づけない。名称が違えば近くても対応づけない', () => {
    const { matched, unmatched } = matchCapacity([r('神足小学校', 34.95, 135.70), r('神足中学校', 34.9230, 135.6970)], fs)
    expect(matched).toHaveLength(0)
    expect(unmatched).toHaveLength(2)
  })
  it('座標がない行は、同名の施設が 1 つだけのときに限って対応づける', () => {
    expect(matchCapacity([r('松ケ崎公民館', null, null)], fs).matched[0]).toMatchObject({ method: 'name_only' })
    expect(matchCapacity([r('中央公園', null, null)], fs).unmatched).toHaveLength(1)
  })
})

describe('収容人数を付ける指定の選び方', () => {
  const none = { flood: false, landslide: false, storm_surge: false, earthquake: true, tsunami: false, fire: false, inland_flood: false, volcano: false }
  const f = facility('E2620900001111', '北小学校', 35, 135)
  f.designations.emergency_site = [
    { source_id: 'E2620900001201', name: '北小学校', hazards: none, note: null, lat: 35, lng: 135 },
    { source_id: 'E2620900001202', name: '北小学校（校庭）', hazards: none, note: null, lat: 35, lng: 135 },
  ]
  const r = (name: string, sourceId: string | null = null) => ({ name, lat: 35, lng: 135, sourceId, persons: 100, raw: '100', alsoShelter: null })
  it('共通ID が一致する指定に付ける', () => {
    expect(pickDesignation(r('別名', 'E2620900001202'), f)?.source_id).toBe('E2620900001202')
  })
  it('名称が同じなら、緊急避難場所の指定を先に選ぶ（自治体の一覧は緊急避難場所の一覧のため）', () => {
    expect(pickDesignation(r('北小学校'), f)?.source_id).toBe('E2620900001201')
  })
  it('建物と校庭を取り違えない', () => {
    expect(pickDesignation(r('北小学校（校庭）'), f)?.source_id).toBe('E2620900001202')
  })
  it('名称の合う指定がなければ付けない', () => {
    expect(pickDesignation(r('南小学校'), f)).toBeUndefined()
  })
})
