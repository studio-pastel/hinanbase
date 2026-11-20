import { describe, expect, it } from 'vitest'
import { resolvePrefs, suggestMunis, suggestTowns } from '../src/lib/addressSearch.ts'
import type { GeocodeFile } from '../shared/geocode.ts'
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

describe('suggestMunis', () => {
  it('市区町村名の一部から候補を出す（前方一致が先）', async () => {
    const { suggestMunis } = await import('../src/lib/addressSearch.ts')
    expect(suggestMunis('府中', index).map((s) => `${s.sub}${s.label}`)).toEqual(['東京都府中市', '広島県府中市', '広島県安芸郡府中町'])
    expect(suggestMunis('江東', index).map((s) => s.label)).toEqual(['江東区'])
    expect(suggestMunis('浜', index).map((s) => s.label)).toEqual(['横浜市'])
    expect(suggestMunis('東京都', index).map((s) => s.label)).toEqual(['江東区', '府中市'])
  })
})

describe('政令指定都市', () => {
  const idx = {
    prefs: [
      { code: '26', name: '京都府', munis: [{ key: '26100', name: '京都市' }, { key: '26201', name: '福知山市' }] },
      { code: '27', name: '大阪府', munis: [{ key: '27100', name: '大阪市' }, { key: '27140', name: '堺市' }] },
    ],
  } as unknown as MuniIndexFile
  it('都府県を省いた名前と市名が重なっても市の候補を出す', () => {
    expect(suggestMunis('大阪市北', idx).map((s) => s.label)).toEqual(['大阪市'])
    expect(suggestMunis('京都市', idx).map((s) => s.label)).toEqual(['京都市'])
    expect(suggestMunis('大阪府堺', idx).map((s) => s.label)).toEqual(['堺市'])
  })
  it('区の候補を出す', () => {
    const file = { pref_name: '大阪府', munis: [{ name: '大阪市北区' }, { name: '大阪市都島区' }, { name: '堺市北区' }], towns: [] } as unknown as GeocodeFile
    const pref = idx.prefs[1]!
    expect(suggestTowns('大阪市北', pref, file).map((s) => s.label)).toEqual(['大阪市北区'])
    expect(suggestTowns('大阪市北区', pref, file).map((s) => s.label)).toEqual(['大阪市北区'])
    expect(suggestTowns('大阪市', pref, file).map((s) => s.label)).toEqual(['大阪市北区', '大阪市都島区'])
  })
})
