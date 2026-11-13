import { readFileSync } from 'node:fs'
import { parse } from 'csv-parse/sync'
import { HAZARD_KEYS, type Hazards } from '../../shared/types.ts'

/** D1 の1行（どちらのファイルの行かは kind で区別） */
export interface SourceRow {
  sourceId: string
  kind: 'shelter' | 'emergency'
  /** 共通ID の先頭 11 文字。「同じ住所」を表す（DATA_NOTES 2章） */
  prefix: string
  muniKey: string
  muniLabel: string
  /** 共通ID の区分の桁。避難所は 1 か 2、緊急避難場所は 0 */
  klass: string
  /** 枝番（36 進） */
  branch: number
  name: string
  address: string
  lat: number
  lng: number
  note: string
  /** 避難所のみ */
  target: string
  other: string
  /** 緊急避難場所のみ */
  hazards: Hazards | null
}

export const SHELTER_COLUMNS = [
  'NO', '共通ID', '都道府県名及び市町村名', '施設・場所名', '住所', '指定緊急避難場所との住所同一',
  'その他市町村長が必要と認める事項', '受入対象者', '緯度', '経度', '備考',
]
export const HAZARD_COLUMNS = [
  '洪水', '崖崩れ、土石流及び地滑り', '高潮', '地震', '津波', '大規模な火事', '内水氾濫', '火山現象',
]
export const EMERGENCY_COLUMNS = [
  'NO', '共通ID', '都道府県名及び市町村名', '施設・場所名', '住所', ...HAZARD_COLUMNS,
  '指定避難所との住所同一', '緯度', '経度', '備考',
]

const ID_PATTERN = /^E\d{10}([12])([0-2])([0-9A-Z])$/

/**
 * D1 の CSV を読む。想定と違う形（列名、ID の形式、座標、フラグの値）を見つけたら
 * 黙って吸収せず、すべて集めて例外にする（CLAUDE.md「仕様と実データが食い違ったら報告」）。
 */
export function parseSourceCsv(text: string, kind: 'shelter' | 'emergency'): SourceRow[] {
  const records = parse(text, { bom: true, relax_column_count: false }) as string[][]
  const header = records[0]
  const expected = kind === 'shelter' ? SHELTER_COLUMNS : EMERGENCY_COLUMNS
  if (!header || header.join('\t') !== expected.join('\t')) {
    throw new Error(`列名が想定と違います（${kind}）: ${JSON.stringify(header)}`)
  }
  const col = (name: string) => expected.indexOf(name)
  const problems: string[] = []
  const rows: SourceRow[] = []
  const seen = new Set<string>()
  for (let i = 1; i < records.length; i++) {
    const r = records[i]!
    const get = (name: string) => r[col(name)] ?? ''
    const id = get('共通ID')
    const m = ID_PATTERN.exec(id)
    const lat = Number(get('緯度'))
    const lng = Number(get('経度'))
    const where = `${kind} ${i + 1}行目 ${id}`
    if (!m) { problems.push(`${where}: 共通ID の形式が想定外`); continue }
    if (m[1] !== (kind === 'shelter' ? '1' : '2')) problems.push(`${where}: 種別の桁がファイルと合わない`)
    if (kind === 'emergency' && m[2] !== '0') problems.push(`${where}: 緊急避難場所の区分の桁が 0 でない`)
    if (kind === 'shelter' && m[2] === '0') problems.push(`${where}: 避難所の区分の桁が 0`)
    if (seen.has(id)) problems.push(`${where}: 共通ID が重複`)
    seen.add(id)
    if (get('緯度') === '' || get('経度') === '' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      problems.push(`${where}: 緯度経度が読めない`)
    } else if (lat < 20 || lat > 46 || lng < 122 || lng > 154) {
      problems.push(`${where}: 緯度経度が日本の範囲外 (${lat}, ${lng})`)
    }
    if (get('施設・場所名').trim() === '') problems.push(`${where}: 施設名が空`)
    let hazards: Hazards | null = null
    if (kind === 'emergency') {
      hazards = {} as Hazards
      HAZARD_KEYS.forEach((key, idx) => {
        const v = get(HAZARD_COLUMNS[idx]!)
        if (v !== '' && v !== '1') problems.push(`${where}: 災害種別フラグが想定外の値 "${v}"`)
        hazards![key] = v === '1' // 空欄は「指定なし」（DATA_NOTES D-7）
      })
    }
    rows.push({
      sourceId: id,
      kind,
      prefix: id.slice(0, 11),
      muniKey: id.slice(1, 6),
      muniLabel: get('都道府県名及び市町村名'),
      klass: m[2]!,
      branch: parseInt(m[3]!, 36),
      name: get('施設・場所名'),
      address: get('住所'),
      lat,
      lng,
      note: get('備考'),
      target: kind === 'shelter' ? get('受入対象者') : '',
      other: kind === 'shelter' ? get('その他市町村長が必要と認める事項') : '',
      hazards,
    })
  }
  if (problems.length > 0) {
    throw new Error(
      `元データに想定外の値が ${problems.length} 件あります。先頭 20 件:\n` + problems.slice(0, 20).join('\n'),
    )
  }
  return rows
}

export function readSourceCsv(path: string, kind: 'shelter' | 'emergency'): SourceRow[] {
  return parseSourceCsv(readFileSync(path, 'utf8'), kind)
}
