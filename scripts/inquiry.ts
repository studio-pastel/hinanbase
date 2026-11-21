// 照会の記録をつける（docs/INQUIRY.md 4 章）。記録は data/inquiry/log.json（Git に入れて公開する）。
//
//   npm run inquiry -- add 05215 sent --date 2026-12-01 --channel form --template v1
//   npm run inquiry -- add 05215 response --date 2026-12-10 --summary "体育館は全校 FF 式灯油暖房。停電時は使えない" --file "避難所一覧.xlsx"
//   npm run inquiry -- add 05215 no_document --date 2026-12-10 --summary "施設ごとの設備の資料はない"
//   npm run inquiry -- list            状況の集計と、催促の目安（送付から 30 日以上・回答なし）
//   npm run inquiry -- check           記録の検査（日次ビルドでも実行する）
//
// 種類：sent（送付）reminder（催促）response（回答）no_document（資料なしの回答）declined（回答できないとの回答）
//       disclosure_request（情報公開請求）disclosure_decision（開示決定）note（その他）
// 方法：email form phone post counter other
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { daysSinceSent, INQUIRY_CHANNELS, INQUIRY_EVENT_TYPES, inquiryStatus, validateInquiryLog, type InquiryChannel, type InquiryEvent, type InquiryEventType, type InquiryLogFile } from '../shared/inquiry.ts'
import type { MuniIndexFile } from '../shared/types.ts'
import { BUILD_DIR, ROOT } from './lib/paths.ts'

export const LOG_PATH = join(ROOT, 'data', 'inquiry', 'log.json')
const TARGETS_PATH = join(ROOT, 'data', 'inquiry', 'targets.json')

export function loadLog(): InquiryLogFile {
  return existsSync(LOG_PATH)
    ? (JSON.parse(readFileSync(LOG_PATH, 'utf8')) as InquiryLogFile)
    : { note: '自治体への照会の記録（docs/INQUIRY.md）。事実だけを残す。個人名・連絡先は書かない', munis: {} }
}

/** 市区町村キー → 名前（施設データの索引から。なければ照会先の一覧から） */
function muniNames(): Map<string, string> {
  const m = new Map<string, string>()
  const idxPath = join(BUILD_DIR, 'summary', 'munis.json')
  if (existsSync(idxPath)) {
    const idx = JSON.parse(readFileSync(idxPath, 'utf8')) as MuniIndexFile
    for (const p of idx.prefs) for (const x of p.munis) m.set(x.key, `${p.name}${x.name}`)
  }
  if (existsSync(TARGETS_PATH)) {
    for (const t of (JSON.parse(readFileSync(TARGETS_PATH, 'utf8')) as { targets: { key: string; pref: string; name: string }[] }).targets) if (!m.has(t.key)) m.set(t.key, `${t.pref}${t.name}`)
  }
  return m
}

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const args = (name: string) => process.argv.flatMap((a, i) => (a === `--${name}` ? [process.argv[i + 1]!] : []))

const [cmd, ...rest] = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !all[i - 1]?.startsWith('--'))
const names = muniNames()

if (cmd === 'add') {
  const [key, type] = rest as [string, InquiryEventType]
  if (!key || !/^\d{5}$/.test(key)) throw new Error('市区町村キー（5 桁）を指定してください')
  if (!names.has(key)) throw new Error(`${key} は施設データにない市区町村です`)
  if (!INQUIRY_EVENT_TYPES.includes(type)) throw new Error(`種類は ${INQUIRY_EVENT_TYPES.join(' / ')} のどれか`)
  const date = arg('date') ?? new Date().toISOString().slice(0, 10)
  const channel = arg('channel') as InquiryChannel | undefined
  if (channel && !INQUIRY_CHANNELS.includes(channel)) throw new Error(`方法は ${INQUIRY_CHANNELS.join(' / ')} のどれか`)
  const log = loadLog()
  const m = (log.munis[key] ??= { name: names.get(key)!, events: [] })
  const n = Math.max(0, ...m.events.map((e) => Number(e.id.split('-')[1]))) + 1
  const e: InquiryEvent = { id: `${key}-${n}`, date, type }
  if (channel) e.channel = channel
  if (arg('template')) e.template = arg('template')
  if (arg('summary')) e.summary = arg('summary')
  const files = args('file').map((f) => { const [name, url] = f.split('|'); return url ? { name: name!, url } : { name: name! } })
  if (files.length) e.files = files
  m.events.push(e)
  m.events.sort((a, b) => a.date.localeCompare(b.date) || Number(a.id.split('-')[1]) - Number(b.id.split('-')[1]))
  const errors = validateInquiryLog(log, new Set(names.keys()))
  if (errors.length) throw new Error(errors.join('\n'))
  log.munis = Object.fromEntries(Object.entries(log.munis).sort(([a], [b]) => a.localeCompare(b)))
  writeFileSync(LOG_PATH, JSON.stringify(log, null, 1) + '\n')
  console.log(`記録しました：${e.id}（${m.name}、${type}、${date}）→ 状況：${inquiryStatus(m.events)}`)
} else if (cmd === 'list') {
  const log = loadLog()
  const targets = existsSync(TARGETS_PATH) ? (JSON.parse(readFileSync(TARGETS_PATH, 'utf8')) as { targets: { key: string }[] }).targets.map((t) => t.key) : []
  const keys = [...new Set([...targets, ...Object.keys(log.munis)])]
  const counts: Record<string, number> = {}
  const today = new Date().toISOString().slice(0, 10)
  const remind: string[] = []
  for (const k of keys) {
    const ev = log.munis[k]?.events ?? []
    const s = inquiryStatus(ev)
    counts[s] = (counts[s] ?? 0) + 1
    const d = daysSinceSent(ev, today)
    if (s === 'sent' && d !== null && d >= 30 && !ev.some((e) => e.type === 'reminder')) remind.push(`${k} ${names.get(k)}（送付から ${d} 日）`)
  }
  console.log('状況：', counts)
  console.log(remind.length ? `催促の目安（30 日以上・回答なし・未催促）：\n  ${remind.join('\n  ')}` : '催促の目安に当たる市町村はありません')
} else if (cmd === 'check') {
  const errors = validateInquiryLog(loadLog(), new Set(names.keys()))
  if (errors.length) { console.error(errors.join('\n')); process.exit(1) }
  console.log('照会の記録：問題なし')
} else {
  console.log('使い方：npm run inquiry -- add <市区町村キー> <種類> --date YYYY-MM-DD [--channel 方法] [--template 版] [--summary 要旨] [--file 名前|URL]\n        npm run inquiry -- list\n        npm run inquiry -- check')
}
