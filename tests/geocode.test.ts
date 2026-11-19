import { describe, expect, it } from 'vitest'
import { geocode, nearest, normalizeAddress, pointCells, toKanjiNumber, type GeocodeFile, type PointRow } from '../shared/geocode.ts'

const file: GeocodeFile = {
  pref_code: '13', pref_name: '東京都', source: 'test',
  munis: [
    { code: '13121', name: '足立区', key: '13121' },
    { code: '13224', name: '多摩市', key: '13224' },
    { code: '13308', name: '西多摩郡奥多摩町', key: null },
    { code: '13101', name: '千代田区', key: '13101' },
  ],
  towns: [
    [0, '綾瀬一丁目', 35.76, 139.82, 3], [0, '綾瀬二丁目', 35.77, 139.82, 3], [0, '綾瀬三丁目', 35.78, 139.82, 3],
    [1, '落合一丁目', 35.62, 139.42, 3], [1, '落合二丁目', 35.63, 139.42, 3],
    [2, '大字氷川', 35.80, 139.10, 1],
    [3, '内幸町一丁目', 35.6708, 139.7581, 3], [3, '霞が関一丁目', 35.675, 139.75, 3],
  ],
}

describe('住所の正規化', () => {
  it('全角数字・空白・ヶ・「1丁目」をそろえる', () => {
    expect(normalizeAddress('東京都 千代田区　内幸町１丁目１−１')).toBe('東京都千代田区内幸町一丁目1-1')
    expect(normalizeAddress('霞ヶ関')).toBe('霞ケ関')
    expect(toKanjiNumber(12)).toBe('十二')
    expect(toKanjiNumber(30)).toBe('三十')
  })
})

describe('町丁目への照合（端末内で行う）', () => {
  it('丁目まで書かれていれば、その町丁目の代表点を返す', () => {
    const r = geocode('東京都千代田区内幸町1丁目1-1', file)
    expect(r).toMatchObject({ status: 'found', hit: { town: '内幸町一丁目', level: 'town', muni: { key: '13101' } } })
  })
  it('都道府県名を省いても、「町名2-3-4」の形でも当たる', () => {
    expect(geocode('足立区綾瀬2-3-4', file)).toMatchObject({ status: 'found', hit: { town: '綾瀬二丁目' } })
  })
  it('郡名の有無を問わない。「大字」を省いても当たる', () => {
    expect(geocode('奥多摩町氷川123', file)).toMatchObject({ status: 'found', hit: { town: '大字氷川' } })
    expect(geocode('西多摩郡奥多摩町大字氷川123', file)).toMatchObject({ status: 'found' })
  })
  it('「霞ヶ関」と「霞が関」の違いを吸収する', () => {
    expect(geocode('千代田区霞が関1-2', file)).toMatchObject({ status: 'found', hit: { town: '霞が関一丁目' } })
  })
  it('丁目が書かれていなければ、候補の丁目を返す（決めつけない）', () => {
    const r = geocode('東京都足立区綾瀬', file)
    expect(r.status).toBe('choose')
    if (r.status === 'choose') expect(r.candidates.map((c) => c.town)).toEqual(['綾瀬一丁目', '綾瀬二丁目', '綾瀬三丁目'])
  })
  it('番地と丁目の区別がつかない数（落合12-29。落合は二丁目まで）は当てずに候補を返す', () => {
    const r = geocode('多摩市落合12-29', file)
    expect(r.status).toBe('choose')
  })
  it('町名が見つからなければ、市区町村の中心を地図の初期位置として返す', () => {
    const r = geocode('多摩市永山1-5', file)
    expect(r).toMatchObject({ status: 'not_found', muni: { level: 'muni', muni: { name: '多摩市' } } })
  })
  it('市区町村も分からなければ何も返さない', () => {
    expect(geocode('一ノ宮1-25-1', file)).toEqual({ status: 'not_found', muni: null })
  })
})

describe('近くの施設', () => {
  const row = (id: string, lat: number, lng: number): PointRow => [id, '13101', id, lat, lng, 3, 'unknown', 0, 0, 0]
  it('半径 3km 以内を近い順に返す', () => {
    const r = nearest([row('far', 35.70, 139.76), row('near', 35.672, 139.758), row('mid', 35.68, 139.758)], { lat: 35.6708, lng: 139.7581 })
    expect(r.mode).toBe('radius')
    expect(r.items.map((x) => x.row[0])).toEqual(['near', 'mid'])
  })
  it('3km 以内になければ最寄りの 5 件', () => {
    const rows = Array.from({ length: 8 }, (_, i) => row(`p${i}`, 35.8 + i * 0.01, 139.76))
    const r = nearest(rows, { lat: 35.67, lng: 139.76 })
    expect(r.mode).toBe('nearest')
    expect(r.items).toHaveLength(5)
    expect(r.items[0]!.row[0]).toBe('p0')
  })
  it('地点の周辺の区画だけを読む（区画の境目では隣も読む）', () => {
    expect(pointCells(35.5, 139.5, 3000)).toEqual(['35_139'])
    expect(pointCells(35.99, 139.5, 3000)).toEqual(['35_139', '36_139'])
  })
})
