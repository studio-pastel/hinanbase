import { describe, expect, it } from 'vitest'
import { buildFacility, hazardMask, isRestrictedOnly, kindFlags, phase1Scores } from '../scripts/lib/facility.ts'
import { mergeRows } from '../scripts/lib/merge.ts'
import { EMERGENCY_COLUMNS, SHELTER_COLUMNS, parseSourceCsv } from '../scripts/lib/source.ts'
import { row } from './fixtures.ts'

const csv = (cols: string[], ...lines: string[][]) =>
  '﻿' + [cols, ...lines].map((l) => l.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\r\n') + '\r\n'

describe('D1 の CSV の読み込み', () => {
  it('BOM・CRLF・セル内改行を含む避難所ファイルを読める', () => {
    const rows = parseSourceCsv(
      csv(SHELTER_COLUMNS, ['1', 'E0110000001121', '北海道札幌市', '福祉\nセンター', '北海道札幌市1', '', '', '要配慮者', '43.03', '141.48', '']),
      'shelter',
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ muniKey: '01100', prefix: 'E0110000001', klass: '2', target: '要配慮者', hazards: null })
  })

  it('災害種別フラグは 1 を true、空欄を false（指定なし）として読む', () => {
    const rows = parseSourceCsv(
      csv(EMERGENCY_COLUMNS, ['1', 'E0110000001201', '北海道札幌市', '公園', '北海道札幌市1', '1', '', '', '1', '', '', '', '', '', '43.03', '141.48', '']),
      'emergency',
    )
    expect(rows[0]!.hazards).toMatchObject({ flood: true, landslide: false, earthquake: true, volcano: false })
  })

  it('想定外の値は黙って吸収せず、例外にする', () => {
    const bad = (line: string[]) => () => parseSourceCsv(csv(EMERGENCY_COLUMNS, line), 'emergency')
    const base = ['1', 'E0110000001201', '北海道札幌市', '公園', '北海道札幌市1', '1', '', '', '', '', '', '', '', '', '43.03', '141.48', '']
    expect(bad(base.with(5, '○'))).toThrow(/災害種別フラグ/)
    expect(bad(base.with(14, ''))).toThrow(/緯度経度/)
    expect(bad(base.with(14, '0'))).toThrow(/範囲外/)
    expect(bad(base.with(1, 'X123'))).toThrow(/共通ID/)
    expect(() => parseSourceCsv(csv(['NO', '共通ID'], ['1', 'E0110000001201']), 'emergency')).toThrow(/列名/)
  })
})

describe('施設データの組み立て', () => {
  it('Phase 1 のスコアは4軸とも null（0 で埋めない）で、根拠を breakdown に持つ', () => {
    const s = phase1Scores()
    expect([s.hazard, s.capacity, s.habitability, s.logistics]).toEqual([null, null, null, null])
    expect(s.display_state).toBe('unknown')
    expect(s.breakdown.method_version).toBeTypeOf('string')
    expect(s.coverage_ratio).toBe(0)
    expect(s).not.toHaveProperty('total')
  })

  it('指定は種別ごとの配列で持ち、災害種別は全行の和集合にする（DATA_NOTES D-12）', () => {
    const none = { flood: false, landslide: false, storm_surge: false, earthquake: false, tsunami: false, fire: false, inland_flood: false, volcano: false }
    const { clusters } = mergeRows([
      row('E0110000001111', 'A小学校', { note: '  ' }),
      row('E0110000001201', 'A小学校', { hazards: { ...none, flood: true } }),
      row('E0110000001202', 'A小学校（校庭）', { hazards: { ...none, fire: true } }),
    ])
    const f = buildFacility('E0110000001111', clusters[0]!)
    expect(f.designations.shelter).toHaveLength(1)
    expect(f.designations.emergency_site.map((d) => d.source_id)).toEqual(['E0110000001201', 'E0110000001202'])
    expect(f.designations.shelter[0]!.note).toBeNull()
    expect(kindFlags(f)).toBe(3)
    expect(hazardMask(f)).toBe((1 << 0) | (1 << 5))
    expect(f.amenities).toEqual({})
  })

  it('受入対象者限定の判定：区分の桁が 2、または受入対象者に記入あり（DATA_NOTES D-11）', () => {
    const only = buildFacility('x', mergeRows([row('E0110000001121', '福祉センター')]).clusters[0]!)
    expect(isRestrictedOnly(only)).toBe(true)
    const byTarget = buildFacility('x', mergeRows([row('E0110000002111', '会館', { target: '要配慮者' })]).clusters[0]!)
    expect(byTarget.designations.shelter[0]!.restricted).toBe(true)
    const mixed = buildFacility('x', mergeRows([row('E0110000003111', '学園'), row('E0110000003121', '学園')]).clusters[0]!)
    expect(isRestrictedOnly(mixed)).toBe(false)
    const emergencyOnly = buildFacility('x', mergeRows([row('E0110000004201', '公園')]).clusters[0]!)
    expect(emergencyOnly.designations.shelter).toEqual([])
    expect(isRestrictedOnly(emergencyOnly)).toBe(false)
  })
})
