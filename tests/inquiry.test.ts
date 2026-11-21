import { describe, expect, it } from 'vitest'
import { daysSinceSent, inquiryStatus, validateInquiryLog, type InquiryEvent, type InquiryLogFile } from '../shared/inquiry.ts'

const ev = (id: string, date: string, type: InquiryEvent['type'], extra: Partial<InquiryEvent> = {}): InquiryEvent => ({ id, date, type, ...extra })

describe('照会の状況', () => {
  it('記録がなければ未照会、送付で回答待ち、回答で回答あり', () => {
    expect(inquiryStatus([])).toBe('not_sent')
    expect(inquiryStatus([ev('1-1', '2026-12-01', 'sent')])).toBe('sent')
    expect(inquiryStatus([ev('1-1', '2026-12-01', 'sent'), ev('1-2', '2026-12-31', 'reminder')])).toBe('sent')
    expect(inquiryStatus([ev('1-1', '2026-12-01', 'sent'), ev('1-2', '2026-12-10', 'response')])).toBe('answered')
  })
  it('資料なし・情報公開請求も状況として残す。回答があればそちらを優先する', () => {
    expect(inquiryStatus([ev('1-1', '2026-12-01', 'sent'), ev('1-2', '2026-12-10', 'no_document')])).toBe('no_document')
    expect(inquiryStatus([ev('1-1', '2026-12-01', 'sent'), ev('1-2', '2027-01-10', 'disclosure_request')])).toBe('disclosure')
    expect(inquiryStatus([ev('1-1', '2026-12-01', 'sent'), ev('1-2', '2026-12-10', 'response'), ev('1-3', '2026-12-20', 'no_document')])).toBe('answered')
  })
  it('日付の順に並べ替えてから決める', () => {
    expect(inquiryStatus([ev('1-2', '2026-12-10', 'response'), ev('1-1', '2026-12-01', 'sent')])).toBe('answered')
  })
  it('最初の送付からの日数', () => {
    expect(daysSinceSent([], '2026-12-31')).toBeNull()
    expect(daysSinceSent([ev('1-1', '2026-12-01', 'sent')], '2026-12-31')).toBe(30)
  })
})

describe('照会の記録の検査', () => {
  const log = (events: InquiryEvent[], key = '05215'): InquiryLogFile => ({ note: '', munis: { [key]: { name: '秋田県仙北市', events } } })
  const known = new Set(['05215'])
  it('正しい記録は通す', () => {
    expect(validateInquiryLog(log([ev('05215-1', '2026-12-01', 'sent', { channel: 'form' })]), known)).toEqual([])
  })
  it('知らない市区町村・重複した ID・日付の誤り・ID の形を指摘する', () => {
    expect(validateInquiryLog(log([], '99999'), known)[0]).toMatch(/施設データにない/)
    expect(validateInquiryLog(log([ev('05215-1', '2026-12-01', 'sent'), ev('05215-1', '2026-12-02', 'sent')]), known).join()).toMatch(/重複/)
    expect(validateInquiryLog(log([ev('05215-1', '2026/12/01', 'sent')]), known).join()).toMatch(/日付/)
    expect(validateInquiryLog(log([ev('1-1', '2026-12-01', 'sent')]), known).join()).toMatch(/連番/)
  })
  it('要旨に連絡先らしい文字列があれば止める（公開リポジトリのため）', () => {
    expect(validateInquiryLog(log([ev('05215-1', '2026-12-01', 'response', { summary: '担当 0187-43-1111' })]), known).join()).toMatch(/連絡先/)
    expect(validateInquiryLog(log([ev('05215-1', '2026-12-01', 'response', { summary: '担当 someone@example.jp' })]), known).join()).toMatch(/連絡先/)
  })
})
