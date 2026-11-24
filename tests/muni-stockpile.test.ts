import { describe, expect, it } from 'vitest'
import { mapColumns, tableFromPdfPage, tableFromSheet } from '../scripts/lib/muni-stockpile.ts'
import { compareStockpile } from '../shared/stockpileChange.ts'

// pdftotext -bbox の形の語を作る
const w = (x0: number, y0: number, x1: number, text: string, h = 6) => `<word xMin="${x0}" yMin="${y0}" xMax="${x1}" yMax="${y0 + h}">${text}</word>`

describe('Excel の表（列 = 品目、行 = 市区町村）', () => {
  it('単位の行のすぐ上を品目名とし、空欄・「-」は値を持たない。団体コードがあれば持つ', () => {
    const grid = [
      ['県及び市町村の備蓄状況（令和8年7月1日時点）'],
      ['項目', '', '', '毛布', '段ボールベッド', '携帯トイレ', 'パーティション', '扇風機'],
      ['単位', '', '', '枚', 'セット', '回分', '枚', '台'],
      ['032018', '岩手県', '盛岡市', '28135', '4473', '', '-', '0'],
      ['', '', '市町村計', '1', '2', '3', '4', '5'],
    ]
    const t = tableFromSheet(grid)
    expect(t.columns.map((c) => c.label)).toEqual(['毛布', '段ボールベッド', '携帯トイレ', 'パーティション', '扇風機'])
    expect(t.rows[0]).toEqual({ name: '盛岡市', code: '032018', values: { 0: 28135, 1: 4473, 4: 0 } })
    expect(t.rows[1]!.name).toBe('市町村計')
  })
})

describe('PDF の表', () => {
  it('見出しが長い列でも、右寄せの数は右端で列を決める（中心の中点で区切ると隣の列に入る）', () => {
    // 列 0 は幅 254（中心 143、右端 270）、列 1・2 は幅 188。単位の中心 = 列の中心
    const xml = [
      w(10, 10, 200, '県市町村備蓄状況の公表（令和8年7月1日時点）'),
      w(10, 30, 30, '品目'), w(60, 30, 226, 'ビスケット・クラッカー類（アレルギー対応）'), w(320, 30, 410, 'その他主食類'), w(510, 30, 590, '毛布'),
      w(10, 40, 30, '単位'), w(140, 40, 146, '食'), w(364, 40, 370, '食'), w(552, 40, 558, '枚'), w(740, 40, 746, '台'), w(928, 40, 934, '個'),
      w(4, 60, 24, '甲市'), w(262, 60, 270, '5'), w(640, 60, 648, '7'),
    ].join('')
    const t = tableFromPdfPage(xml)
    expect(t.columns.map((c) => c.unit)).toEqual(['食', '食', '枚', '台', '個'])
    expect(t.rows).toEqual([{ name: '甲市', values: { 0: 5, 2: 7 } }])
    expect(t.problems).toEqual([])
  })
})

describe('列 → 項目', () => {
  const defs = [
    { key: 'toilet_portable', cao: '携帯トイレ' },
    { key: 'toilet_simple', cao: '簡易トイレ' },
    { key: 'stove_kerosene', cao: 'ストーブ（石油）' },
    { key: 'sanitary', cao: '生理用品', muni: ['生理用ナプキン'] },
    { key: 'blanket', cao: '毛布' },
  ]
  const units = { toilet_portable: '回分', toilet_simple: '台', stove_kerosene: '台', sanitary: '枚', blanket: '枚' }
  it('まとまりの見出しが付いた名前・同じ語が 2 回の名前・別名で当て、台と基は同じ数え方とする', () => {
    const { map, problems } = mapColumns([
      { label: '携帯トイレ携帯トイレ', unit: '回分' },
      { label: '簡易トイレ', unit: '基' },
      { label: '暖房器具ストーブ(石油)', unit: '台' },
      { label: '生理用品生理用ナプキン', unit: '枚' },
      { label: 'アルミ毛布', unit: '枚' },
    ], defs, units)
    expect(Object.fromEntries(map)).toEqual({ toilet_portable: 0, toilet_simple: 1, stove_kerosene: 2, sanitary: 3 })
    expect(problems).toEqual([])
  })
  it('単位が違う列は当てず、同じ項目に 2 列当たればその項目は使わない', () => {
    const { map, problems } = mapColumns([
      { label: '毛布', unit: '枚' }, { label: '毛布毛布', unit: '枚' }, { label: '携帯トイレ', unit: '個' },
    ], defs, units)
    expect(map.size).toBe(0)
    expect(problems.join()).toMatch(/単位が国の調査と違う/)
    expect(problems.join()).toMatch(/当たる列が 2 つ/)
  })
})

describe('国の調査とその後の公表の比べ', () => {
  it('両方に数がある品目だけ。3 倍以上・3 分の 1 以下・0 をまたぐ違いは要確認で差を出さない', () => {
    const rows = compareStockpile(['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      { a: 10, b: 10, c: 10, d: 10, e: 10, f: 0, g: 5 },
      { a: 10, b: 12, c: 8, d: 30, e: 0, f: 4 })
    expect(rows.map((r) => [r.key, r.kind, r.diff])).toEqual([
      ['a', 'same', null], ['b', 'up', 2], ['c', 'down', -2], ['d', 'check', null], ['e', 'check', null], ['f', 'check', null],
    ])
  })
})
