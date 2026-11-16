// 自治体が公開している「指定緊急避難場所一覧」などの CSV から、想定収容人数を読み取り、施設と突き合わせる
// （SPEC §2.3 の D3、DATA_NOTES 12.7・12.11）。列名や値の書き方は自治体ごとに違う。
import type { EmergencyDesignation, Facility, ShelterDesignation } from '../../shared/types.ts'
import { coreName, distanceM, normalizeName } from './normalize.ts'

export interface CapacityRow {
  name: string
  lat: number | null
  lng: number | null
  /** 国土地理院の共通ID（列がある自治体だけ） */
  sourceId: string | null
  /** 読み取れた人数。読み取れなければ null */
  persons: number | null
  /** もとの文字列（「1,350人（3.3平方メートルあたり2人）」など。算出の前提が書かれていることがある） */
  raw: string
  /** 「指定避難所との重複」の列が立っているか。列がなければ null */
  alsoShelter: boolean | null
}

/** 引用符付きの値と、値の中の改行に対応した CSV の読み取り */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some((v) => v !== '')) rows.push(row)
      row = []
    } else cell += c
  }
  row.push(cell)
  if (row.some((v) => v !== '')) rows.push(row)
  return rows
}

/** UTF-8（BOM 付きを含む）か Shift_JIS かを判定して文字列にする */
export function decodeCsv(buf: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(new RegExp(`^${String.fromCharCode(0xfeff)}`), '')
  } catch {
    return new TextDecoder('shift_jis').decode(buf)
  }
}

/**
 * 想定収容人数の読み取り。先頭の数字だけを人数とする（「1,350人（3.3平方メートルあたり2人）」→ 1350）。
 * 空欄・0・数字で始まらない値は null（0 人や推定値にしない）。
 */
export function parsePersons(raw: string): number | null {
  const s = raw.normalize('NFKC').trim()
  const m = s.match(/^(?:約)?(\d{1,3}(?:,\d{3})+|\d+)\s*(?:人|名)?(?=$|[\s(（])/)
  if (!m) return null
  const n = Number(m[1]!.replace(/,/g, ''))
  return Number.isInteger(n) && n > 0 ? n : null
}

const find = (header: string[], ...patterns: RegExp[]) => {
  for (const p of patterns) {
    // 見出しの中の改行や空白は無視する（「想定\n収容人数」など）
    const i = header.findIndex((h) => p.test(h.normalize('NFKC').replace(/\s+/g, '')))
    if (i >= 0) return i
  }
  return -1
}

/** 見出し行から必要な列を探して読む。収容人数の列がなければ null */
export function readCapacityRows(text: string): CapacityRow[] | null {
  const rows = parseCsv(text)
  const header = rows[0] ?? []
  const col = {
    name: find(header, /^名称$/, /^施設名$/, /^施設・場所名$/),
    lat: find(header, /^緯度$/),
    lng: find(header, /^経度$/),
    // 「収容人員(一人当たり3m2)」のように、見出しに算出の前提が書かれている場合がある。
    // 「収容人数(一時避難)」「収容人数(滞在避難)」のように種類が分かれている場合は、どれを使うか決められないので読まない
    persons: find(header, /^想定収容人数$/, /^収容人数$/, /^収容人員(\(一人当たり[^)]*\))?$/),
    sourceId: find(header, /共通ID/),
    also: find(header, /^指定避難所との重複$/),
  }
  if (col.name < 0 || col.persons < 0) return null
  const num = (v: string | undefined) => {
    const n = Number((v ?? '').trim())
    return (v ?? '').trim() !== '' && Number.isFinite(n) ? n : null
  }
  // 見出しに算出の前提が書かれていれば、もとの記載に添える
  const basis = (header[col.persons] ?? '').normalize('NFKC').replace(/\s+/g, '').match(/\((一人当たり[^)]*)\)/)?.[1]
  return rows.slice(1).map((r) => {
    const value = (r[col.persons] ?? '').trim()
    const raw = basis && value !== '' ? `${value}（${basis}）` : value
    const sid = col.sourceId >= 0 ? (r[col.sourceId] ?? '').trim() : ''
    return {
      name: (r[col.name] ?? '').trim(),
      lat: col.lat >= 0 ? num(r[col.lat]) : null,
      lng: col.lng >= 0 ? num(r[col.lng]) : null,
      sourceId: /^E\d{10}[0-9A-Z]{3}$/.test(sid) ? sid : null,
      persons: parsePersons(value),
      raw,
      alsoShelter: col.also >= 0 ? /^(1|○|〇|有|あり)$/.test((r[col.also] ?? '').trim()) : null,
    }
  })
}

/**
 * 自治体の CSV と国土地理院のデータで揺れやすい書き方をそろえた名称。
 * 「長岡京市立神足小学校」と「神足小学校」、「松ケ崎」と「松ヶ崎」、「ホ－ム」と「ホーム」を同じとみなす。位置が近い場合の照合にだけ使う。
 */
export function looseName(s: string): string {
  return normalizeName(s).replace(/^[^立]{1,8}[都道府県市区町村]立/, '').replace(/[ヶケが]/g, 'ケ').replace(/[-‐−–—ｰ]/g, 'ー')
}

/**
 * 対応づいた行を、施設の中のどの指定に付けるかを決める。
 *   共通ID が一致した指定 → 名称が一致する緊急避難場所の指定 → 名称が一致する指定避難所の指定 の順。
 * 自治体の CSV は「指定緊急避難場所一覧」なので、緊急避難場所の指定を先に見る。どれにも当たらなければ付けない。
 */
export function pickDesignation(row: CapacityRow, f: Facility): EmergencyDesignation | ShelterDesignation | undefined {
  const all = [...f.designations.emergency_site, ...f.designations.shelter]
  if (row.sourceId) {
    const direct = all.find((d) => d.source_id === row.sourceId)
    if (direct) return direct
  }
  const n = normalizeName(row.name)
  const c = coreName(row.name)
  const l = looseName(row.name)
  const same = all.filter((d) => normalizeName(d.name) === n || (c.length >= 3 && coreName(d.name) === c) || (l.length >= 3 && looseName(d.name) === l))
  // 完全に同じ名称の指定を優先する（「〇〇小学校」と「〇〇小学校（校庭）」を取り違えない）
  const exact = same.find((d) => normalizeName(d.name) === n) ?? same[0]
  if (exact) return exact
  // 一覧での名称を含むだけの指定。候補が 1 つのときだけ選ぶ（建物と校庭のどちらか決められない場合は付けない）
  const partial = all.filter((d) => containsName(row.name, d.name))
  return partial.length === 1 ? partial[0] : undefined
}

export type MatchMethod = 'source_id' | 'name_and_location' | 'name_contains_and_location' | 'name_only'
export interface CapacityMatch { row: CapacityRow; facility: Facility; method: MatchMethod; distance_m: number | null }

/** 名称が同じとみなす距離の上限。これより離れていれば別の施設として扱う */
export const MATCH_DISTANCE_M = 300
/** 一覧での名称が施設の名称に含まれるだけの場合（「鳥越公民館」と「鳥越公民館 集会室」）に対応づける距離の上限 */
export const CONTAINS_DISTANCE_M = 100

/**
 * 自治体の一覧での名称（listed）が、施設・指定の名称（ours）に含まれるか（4 文字以上のときだけ）。
 * 逆向き（一覧のほうが細かい：「〇〇中学校グラウンド」「中央公民館_多目的室2」）は、建物全体の人数ではないので対応づけない。
 * 括弧は記号だけ外し、中身は残す（「小学校（体育館）」を「小学校 屋上」に対応づけない）。
 */
function containsName(listed: string, ours: string): boolean {
  const strip = (s: string) => looseName(s).replace(/[()[\]【】「」『』<>〈〉]/g, '')
  const x = strip(listed)
  return x.length >= 4 && strip(ours).includes(x)
}

/**
 * CSV の 1 行を施設に対応づける。あいまいな場合は対応づけない（誤った施設に人数を付けない）。
 *   1) 共通ID が指定の ID と一致
 *   2) 名称が一致（正規化後、または中核名が一致）し、座標が 300m 以内。候補が複数あれば最も近いもの
 *   2') 一覧での名称が施設の名称に含まれ、座標が 100m 以内（候補が複数あれば最も近いもの）
 *   3) 座標がない行は、名称が一致する施設が市区町村内に 1 つだけのとき
 */
export function matchCapacity(rows: CapacityRow[], facilities: Facility[]): { matched: CapacityMatch[]; unmatched: CapacityRow[] } {
  const bySource = new Map<string, Facility>()
  for (const f of facilities) for (const d of [...f.designations.emergency_site, ...f.designations.shelter]) bySource.set(d.source_id, f)
  const names = (f: Facility) => [f.name, ...f.designations.emergency_site.map((d) => d.name), ...f.designations.shelter.map((d) => d.name)]
  const sameName = (a: string, f: Facility) => {
    const n = normalizeName(a)
    const c = coreName(a)
    const l = looseName(a)
    return names(f).some((x) => normalizeName(x) === n || (c.length >= 3 && coreName(x) === c) || (l.length >= 3 && looseName(x) === l))
  }
  const matched: CapacityMatch[] = []
  const unmatched: CapacityRow[] = []
  for (const row of rows) {
    const direct = row.sourceId ? bySource.get(row.sourceId) : undefined
    if (direct) { matched.push({ row, facility: direct, method: 'source_id', distance_m: null }); continue }
    const cands = facilities.filter((f) => sameName(row.name, f))
    if (row.lat !== null && row.lng !== null) {
      const near = cands
        .map((f) => ({ f, d: distanceM({ lat: row.lat!, lng: row.lng! }, f) }))
        .filter((x) => x.d <= MATCH_DISTANCE_M)
        .sort((a, b) => a.d - b.d)
      if (near[0]) { matched.push({ row, facility: near[0].f, method: 'name_and_location', distance_m: Math.round(near[0].d) }); continue }
      const loose = facilities
        .filter((f) => names(f).some((x) => containsName(row.name, x)))
        .map((f) => ({ f, d: distanceM({ lat: row.lat!, lng: row.lng! }, f) }))
        .filter((x) => x.d <= CONTAINS_DISTANCE_M)
        .sort((a, b) => a.d - b.d)
      if (loose[0]) { matched.push({ row, facility: loose[0].f, method: 'name_contains_and_location', distance_m: Math.round(loose[0].d) }); continue }
    } else if (cands.length === 1) {
      matched.push({ row, facility: cands[0]!, method: 'name_only', distance_m: null }); continue
    }
    unmatched.push(row)
  }
  return { matched, unmatched }
}
