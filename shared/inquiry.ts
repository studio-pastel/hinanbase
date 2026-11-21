// 自治体への照会の記録（docs/INQUIRY.md 4 章、DATA_NOTES 17）。
// 記録は事実だけを残す（いつ・何を依頼し・どう回答があったか）。自治体を比べる順位や点数は作らない。

/** 出来事の種類 */
export const INQUIRY_EVENT_TYPES = ['sent', 'reminder', 'response', 'no_document', 'declined', 'disclosure_request', 'disclosure_decision', 'note'] as const
export type InquiryEventType = (typeof INQUIRY_EVENT_TYPES)[number]

export const INQUIRY_CHANNELS = ['email', 'form', 'phone', 'post', 'counter', 'other'] as const
export type InquiryChannel = (typeof INQUIRY_CHANNELS)[number]

export interface InquiryFile {
  /** ファイル名（受け取った資料の名前） */
  name: string
  /** 自治体が掲載先を示した場合の URL。受け取った資料そのものはリポジトリに置かない（個人情報の確認が済んだものだけ別途公開する） */
  url?: string
}

export interface InquiryEvent {
  /** 出来事の ID（市町村キー-連番。施設の値の出典から参照する） */
  id: string
  date: string // YYYY-MM-DD
  type: InquiryEventType
  channel?: InquiryChannel
  /** 依頼文の版（docs/INQUIRY.md の文案。例 v1） */
  template?: string
  /** 回答・経過の要旨。個人名は書かない */
  summary?: string
  files?: InquiryFile[]
}

export interface InquiryLogFile {
  note: string
  munis: Record<string, { name: string; events: InquiryEvent[] }>
}

/** 状況。最新の状態を出来事の並びから決める */
export const INQUIRY_STATUSES = ['not_sent', 'sent', 'answered', 'no_document', 'declined', 'disclosure'] as const
export type InquiryStatus = (typeof INQUIRY_STATUSES)[number]

export function inquiryStatus(events: InquiryEvent[]): InquiryStatus {
  let s: InquiryStatus = 'not_sent'
  for (const e of [...events].sort((a, b) => a.date.localeCompare(b.date))) {
    if (e.type === 'sent' || e.type === 'reminder') { if (s === 'not_sent') s = 'sent' }
    else if (e.type === 'response' || e.type === 'disclosure_decision') s = 'answered'
    else if (e.type === 'no_document') s = s === 'answered' ? s : 'no_document'
    else if (e.type === 'declined') s = s === 'answered' ? s : 'declined'
    else if (e.type === 'disclosure_request') s = s === 'answered' ? s : 'disclosure'
  }
  return s
}

/** 最初の送付から何日たったか（回答待ちの催促の目安。docs/INQUIRY.md では 1 か月で 1 回だけ催促） */
export function daysSinceSent(events: InquiryEvent[], today: string): number | null {
  const sent = events.filter((e) => e.type === 'sent').map((e) => e.date).sort()[0]
  if (!sent) return null
  return Math.floor((Date.parse(today) - Date.parse(sent)) / 86400000)
}

/** 日本時間の今日（YYYY-MM-DD）。日次ビルドは UTC で動くため、日本時間に合わせる */
export function todayJst(now = Date.now()): string {
  return new Date(now + 9 * 3600000).toISOString().slice(0, 10)
}

/** 記録の検査。誤りがあれば文で返す（日次ビルドの前に止めるため）。today は日本時間の今日（todayJst()） */
export function validateInquiryLog(log: InquiryLogFile, knownMunis: Set<string>, today: string): string[] {
  const errors: string[] = []
  const ids = new Set<string>()
  for (const [key, m] of Object.entries(log.munis)) {
    if (!knownMunis.has(key)) errors.push(`${key}: 市区町村キーが施設データにない`)
    for (const e of m.events) {
      if (ids.has(e.id)) errors.push(`${e.id}: ID が重複している`)
      ids.add(e.id)
      if (!e.id.startsWith(`${key}-`)) errors.push(`${e.id}: ID は「${key}-連番」の形にする`)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date) || Number.isNaN(Date.parse(e.date))) errors.push(`${e.id}: 日付が YYYY-MM-DD でない`)
      else if (e.date > today) errors.push(`${e.id}: 日付（${e.date}）が今日（${today}）より後になっている`)
      if (!INQUIRY_EVENT_TYPES.includes(e.type)) errors.push(`${e.id}: 種類が不明（${String(e.type)}）`)
      if (e.channel && !INQUIRY_CHANNELS.includes(e.channel)) errors.push(`${e.id}: 方法が不明（${String(e.channel)}）`)
      for (const f of e.files ?? []) if (f.url && !/^https?:\/\//.test(f.url)) errors.push(`${e.id}: 資料の URL が不正`)
      // メールアドレス・電話番号らしいものを要旨に書かない（公開リポジトリのため）
      if (e.summary && /[\w.+-]+@[\w-]+\.[\w.]+|\d{2,4}-\d{2,4}-\d{3,4}/.test(e.summary)) errors.push(`${e.id}: 要旨に連絡先らしい文字列がある`)
    }
  }
  return errors
}

/** 照会の回答から作った施設の設備の値（data/inquiry/values/<市区町村キー>.json） */
export interface InquiryValuesFile {
  muni_key: string
  /** 根拠になった出来事の ID（InquiryEvent.id） */
  event_id: string
  values: Record<string, Record<string, { value: string | number | boolean; how: string }>>
}

/** 公開用の集計（summary/inquiries.json） */
export interface InquirySummaryFile {
  generated_at: string
  condition: Record<string, number>
  counts: Record<InquiryStatus, number>
  munis: {
    key: string
    pref: string
    name: string
    target: boolean
    status: InquiryStatus
    events: Omit<InquiryEvent, 'id'>[]
    facilities_with_values: number
  }[]
}
