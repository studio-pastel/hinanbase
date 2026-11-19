import { describe, expect, it } from 'vitest'
import { resolvePrefs } from '../src/lib/addressSearch.ts'
import type { MuniIndexFile } from '../shared/types.ts'

const index: MuniIndexFile = {
  generated_at: '',
  prefs: [
    { code: '13', name: '東京都', count: 0, munis: [{ key: '13108', name: '江東区', count: 0 }, { key: '13206', name: '府中市', count: 0 }] },
    { code: '14', name: '神奈川県', count: 0, munis: [{ key: '14100', name: '横浜市', count: 0 }] },
    { code: '34', name: '広島県', count: 0, munis: [{ key: '34208', name: '府中市', count: 0 }, { key: '34309', name: '安芸郡府中町', count: 0 }] },
  ],
}

describe('resolvePrefs', () => {
  it('都道府県名（都府県を省いても可）で決める', () => {
    expect(resolvePrefs('東京都江東区東陽4', index).map((p) => p.code)).toEqual(['13'])
    expect(resolvePrefs('神奈川横浜市中区', index).map((p) => p.code)).toEqual(['14'])
  })
  it('市区町村名から決める。同じ名前があれば候補を返す', () => {
    expect(resolvePrefs('横浜市中区本町', index).map((p) => p.code)).toEqual(['14'])
    expect(resolvePrefs('府中市', index).map((p) => p.code)).toEqual(['13', '34'])
    expect(resolvePrefs('府中町', index).map((p) => p.code)).toEqual(['34'])
  })
  it('見つからなければ空', () => {
    expect(resolvePrefs('どこか', index)).toEqual([])
  })
})
