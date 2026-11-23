import { describe, expect, it } from 'vitest'
import { parseCaoPage, parseCount, parseTokushimaPage } from '../scripts/lib/stockpile.ts'

// pdftotext -bbox の形の語を作る
const w = (x0: number, y0: number, x1: number, text: string, h = 6) => `<word xMin="${x0}" yMin="${y0}" xMax="${x1}" yMax="${y0 + h}">${text}</word>`

describe('数の読み取り', () => {
  it('桁区切り・全角を数にし、数でなければ null', () => {
    expect(parseCount('1,020')).toBe(1020)
    expect(parseCount('１２')).toBe(12)
    expect(parseCount('-')).toBeNull()
    expect(parseCount('〇')).toBeNull()
  })
})

describe('内閣府の市区町村ごとの表', () => {
  // 列 1〜3。列の右端は小項目コードの右端（110・200・290）。数は右寄せ
  const page = (rows: string) => [
    w(10, 10, 80, '都道府県名：テスト県'),
    w(10, 30, 30, '番号'), w(60, 30, 66, '1'), w(150, 30, 156, '2'), w(240, 30, 246, '3'),
    w(70, 40, 110, '毛布'), w(160, 40, 200, '段ボールベッド'), w(250, 40, 290, 'ストーブ（石油）'),
    w(10, 60, 30, '単位'), w(85, 60, 95, '枚'), w(170, 60, 185, 'セット'), w(262, 60, 270, '台'),
    w(10, 70, 50, '小項目コード'), w(70, 70, 110, '000001'), w(160, 70, 200, '000002'), w(250, 70, 290, '000003'),
    rows,
  ].join('')

  it('列の名前・単位と、右端で列を決めた数を返す。空欄の列は値を持たない', () => {
    const r = parseCaoPage(page(w(10, 90, 40, '甲市') + w(90, 90, 110, '1,200') + w(280, 90, 290, '7')))
    expect(r.pref).toBe('テスト県')
    expect(r.columns.map((c) => [c.label, c.unit])).toEqual([['毛布', '枚'], ['段ボールベッド', 'セット'], ['ストーブ（石油）', '台']])
    expect(r.rows).toEqual([{ pref: 'テスト県', name: '甲市', values: { 0: 1200, 2: 7 } }])
    expect(r.problems).toEqual([])
  })
  it('「-」「―」は値を持たない。列が決まらない数は problems に残す', () => {
    const r = parseCaoPage(page(w(10, 90, 40, '乙町') + w(105, 90, 110, '―') + w(130, 90, 140, '5')))
    expect(r.rows[0]!.values).toEqual({})
    expect(r.problems.join()).toMatch(/列が決まらない/)
  })
  it('小項目コードの行がないページは、ほかのページで測った比で右端を決める', () => {
    const withCode = parseCaoPage(page(''))
    const noCode = page(w(10, 90, 40, '丙村') + w(190, 90, 200, '3')).replace(/<word[^>]*>(小項目コード|0000\d\d)<\/word>/g, '')
    expect(parseCaoPage(noCode).problems.join()).toMatch(/右端が決まらない/)
    expect(parseCaoPage(noCode, withCode.rightRatio).rows[0]!.values).toEqual({ 1: 3 })
  })
})

describe('徳島県の避難所ごとの表', () => {
  const head = [
    w(10, 20, 16, 'No'), w(20, 20, 40, '市町村名'), w(50, 20, 60, '種別'), w(90, 20, 100, '名称'), w(150, 20, 165, '所在地'),
    w(190, 14, 200, '想定'), w(190, 20, 200, '収容'), w(190, 26, 200, '人数'),
    w(210, 8, 250, '電化製品'),
    w(210, 16, 225, '暖房機器'), w(212, 22, 224, '(可搬式)'), w(214, 30, 220, '台'),
    w(230, 16, 245, 'エアコン設備'), w(232, 28, 243, '〇:有'), w(232, 32, 243, '✕:無'),
    w(255, 16, 270, '簡易ベッド'), w(260, 30, 266, '台'),
  ].join('')

  it('名称・所在地・想定収容人数と、列ごとの数・〇✕を返す', () => {
    const row = [w(11, 45, 14, '1'), w(20, 45, 35, '甲町'), w(45, 45, 65, '指定避難所'), w(80, 45, 110, '甲小学校'), w(112, 45, 130, '体育館'),
      w(140, 45, 170, '甲町字北1-2'), w(192, 45, 200, '120'), w(220, 45, 225, '3'), w(235, 45, 240, '✕'), w(262, 45, 270, '40')].join('')
    const r = parseTokushimaPage(head + row)
    expect(r.rows).toHaveLength(1)
    const x = r.rows[0]!
    expect([x.muni, x.kind, x.name, x.address, x.capacity]).toEqual(['甲町', '指定避難所', '甲小学校 体育館', '甲町字北1-2', 120])
    expect(x.values).toEqual({ '暖房機器(可搬式)（台）': 3, 'エアコン設備（〇/✕）': '✕', '簡易ベッド（台）': 40 })
    expect(r.problems).toEqual([])
  })
})
