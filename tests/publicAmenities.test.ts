import { describe, expect, it } from 'vitest'
import { isMunicipalSchoolShelter, matchListNames, muniNamesFromGeocode, normFacilityName, parseMextRates, stripGun } from '../scripts/lib/publicAmenities.ts'
import type { Facility } from '../shared/types.ts'

const facility = (id: string, name: string, shelter = true): Facility => ({
  id, name, address: '', lat: 0, lng: 0,
  designations: { emergency_site: [], shelter: shelter ? [{ source_id: id, name, restricted: false, target: null, other: null, note: null, lat: 0, lng: 0 }] : [] },
  merge_rules: [], amenities: {},
  scores: { hazard: null, capacity: null, logistics: null, impact: { life: 'unknown', health: 'unknown', dignity: 'unknown', access: 'unknown' }, coverage_ratio: 0, display_state: 'unknown', hazard_check: { status: 'not_evaluated', overlap: [], checked: [], unchecked: [] }, breakdown: {} },
})

describe('名前の正規化', () => {
  it('郡名だけを外し、名前の中の「郡」は残す', () => {
    expect(stripGun('南津軽郡藤崎町')).toBe('藤崎町')
    expect(stripGun('大和郡山市')).toBe('大和郡山市')
    expect(stripGun('蒲郡市')).toBe('蒲郡市')
    expect(stripGun('小郡市')).toBe('小郡市')
  })
  it('政令指定都市の区は市にまとめる。施設データにない町村も名前は残す', () => {
    const r = muniNamesFromGeocode([
      { code: '27102', name: '大阪市都島区', key: '27100' }, { code: '27103', name: '大阪市福島区', key: '27100' },
      { code: '47353', name: '島尻郡渡嘉敷村', key: null as unknown as string }, { code: '47354', name: '島尻郡座間味村', key: null as unknown as string },
    ])
    expect(r.map((m) => m.name)).toEqual(['大阪市', '渡嘉敷村', '座間味村'])
  })
  it('施設名の設置者名と表記の揺れを揃える', () => {
    expect(normFacilityName('福岡市立 青葉小学校')).toBe('青葉小学校')
    expect(normFacilityName('松ヶ丘小学校')).toBe(normFacilityName('松ケ丘小学校'))
  })
})

describe('市区町村立の小中学校（指定避難所）', () => {
  it('高校・特別支援学校・跡地・校庭だけの施設は対象外', () => {
    expect(isMunicipalSchoolShelter(facility('a', '青葉小学校'))).toBe(true)
    expect(isMunicipalSchoolShelter(facility('b', '県立高等学校'))).toBe(false)
    expect(isMunicipalSchoolShelter(facility('c', '東特別支援学校'))).toBe(false)
    expect(isMunicipalSchoolShelter(facility('d', '旧北小学校'))).toBe(false)
    expect(isMunicipalSchoolShelter(facility('e', '南中学校グラウンド'))).toBe(false)
    expect(isMunicipalSchoolShelter(facility('f', '西小学校', false))).toBe(false)
  })
})

describe('一覧の照合', () => {
  it('同名が複数あれば指定避難所に絞り、それでも複数なら対応づけない', () => {
    const fs = [facility('1', '北小学校'), facility('2', '北小学校', false), facility('3', '南小学校'), facility('4', '南小学校')]
    const m = matchListNames(['北小学校', '南小学校', '東小学校'], fs)
    expect(m.get('北小学校')?.id).toBe('1')
    expect(m.get('南小学校')).toBeUndefined()
    expect(m.get('東小学校')).toBeUndefined()
  })
})

describe('文部科学省の市区町村別グラフの読み取り', () => {
  const word = (x: number, y: number, t: string, w = 6) => `<word xMin="${x}" yMin="${y}" xMax="${x + w}" yMax="${y + 5}">${t}</word>`
  const munis = new Map([['テスト県', [{ name: '甲市', key: '99201' }, { name: '乙町', key: '99301' }]]])
  const page = (vals: string[]) => [
    word(10, 10, 'テスト県'), word(10, 20, '令和8年5月1日時点'),
    ...['100%', '50%', '0%'].map((t, i) => word(83, 100 + i * 40, t)),
    ...vals,
    word(110, 480, 'テスト県'), word(119, 480, '甲市'), word(128, 480, '乙町'), word(137, 480, '甲市乙町学校組合'),
  ].join('\n')

  it('率と名前を横位置で対応づける。文字の並び順には頼らない', () => {
    const { rates, problems } = parseMextRates([page([word(130, 400, '0%', 5), word(108, 400, '20.0%', 10), word(117, 90, '100%', 10), word(136, 400, '0%', 5)])], munis)
    expect(problems).toEqual([])
    expect(rates.map((r) => [r.name, r.key, r.union, r.rate])).toEqual([
      ['テスト県', '', false, 20], ['甲市', '99201', false, 100], ['乙町', '99301', false, 0], ['甲市乙町学校組合', '', true, 0],
    ])
  })
  it('つながった率（100%100%）は等分して割り当てる', () => {
    const { rates } = parseMextRates([page([word(108, 400, '0%', 5), word(113, 90, '100%100%', 20), word(136, 400, '0%', 5)])], munis)
    expect(rates.map((r) => r.rate)).toEqual([0, 100, 100, 0])
  })
  it('数が合わないページは捨てる（推測で埋めない）', () => {
    const { rates, problems } = parseMextRates([page([word(108, 400, '0%', 5)])], munis)
    expect(rates).toEqual([])
    expect(problems[0]).toMatch(/数が合わない/)
  })
})
