// 都道府県がまとめて公表している「県内市町村の備蓄の数」の表を読む（DATA_NOTES 20）。
// 災害対策基本法第 49 条第 2 項（令和 7 年 7 月 1 日施行）で、市区町村は毎年 1 回、備蓄の状況を公表する。
// 表の形は「列 = 品目（見出しの下に単位の行）、行 = 市区町村」。PDF は語の位置（pdftotext -bbox）で、Excel はセルで読む。
// 空欄と「-」は値を持たない（0 で埋めない）。資料に「0」と書いてあるものだけ 0 とする。
import { parseBboxWords, parseCount, type Word } from './stockpile.ts'

export interface TableColumn { label: string; unit: string }
export interface TableRow { name: string; code?: string; values: Record<number, number> }
export interface Table { columns: TableColumn[]; rows: TableRow[]; problems: string[] }

/** 単位として使われる語 */
const UNIT = /^(食|キロ|kg|個|本|枚|台|回|回分|基|セット|缶|缶・本|張|棟|任意|袋|g|ℓ|L|リットル|床|組|式|箱|人分|巻|足|着|パック|丁|膳|対|ケース|m|ｍ|セット・個)$/
const isUnit = (s: string) => UNIT.test(s.normalize('NFKC').replace(/\s/g, ''))
const DASH = /^[-‐－―—ー]$/
const norm = (s: string) => s.normalize('NFKC').replace(/\s/g, '')

// ---------------------------------------------------------------------------
// Excel（シート 1 枚を文字の二次元配列にしたもの）

/**
 * 単位の行（単位の語が 5 つ以上、かつ空でないセルの 7 割以上）を探し、そのすぐ上の行を品目名とする。
 * 品目名のセルが空の列は、さらに上の行を見る。単位の行より下で、単位の列より左に名前がある行を市区町村の行とする
 */
export function tableFromSheet(grid: string[][]): Table {
  const problems: string[] = []
  const unitRow = grid.findIndex((r) => {
    const cells = r.map((c) => c?.trim() ?? '').filter(Boolean)
    const units = cells.filter(isUnit).length
    return units >= 5 && units >= cells.length * 0.7
  })
  if (unitRow < 0) return { columns: [], rows: [], problems: ['単位の行がない'] }
  const colIdx: number[] = []
  grid[unitRow]!.forEach((c, i) => { if (c && isUnit(c)) colIdx.push(i) })
  const firstCol = colIdx[0]!
  const columns = colIdx.map((ci) => {
    let label = ''
    for (let r = unitRow - 1; r >= 0 && !label; r--) label = (grid[r]![ci] ?? '').trim()
    return { label: norm(label), unit: norm(grid[unitRow]![ci]!) }
  })
  const rows: TableRow[] = []
  for (let r = unitRow + 1; r < grid.length; r++) {
    const row = grid[r]!
    const left = row.slice(0, firstCol).map((c) => (c ?? '').trim()).filter(Boolean)
    const name = [...left].reverse().find((c) => !/^\d+$/.test(c) && parseCount(c) === null)
    if (!name) continue
    const code = left.find((c) => /^\d{5,6}$/.test(c))
    const values: Record<number, number> = {}
    colIdx.forEach((ci, k) => {
      const t = (row[ci] ?? '').trim()
      if (!t || DASH.test(t)) return
      const n = parseCount(t)
      if (n === null) problems.push(`${name} 列「${columns[k]!.label}」: 数でない「${t}」`)
      else values[k] = n
    })
    rows.push({ name: norm(name), ...(code ? { code } : {}), values })
  }
  return { columns, rows, problems }
}

/** xlsx の 1 枚目のシートの XML と共有文字列から二次元配列を作る */
export function sheetGrid(sheetXml: string, sharedXml: string | null): string[][] {
  const dec = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
  const shared = sharedXml
    ? [...sharedXml.replace(/<rPh\b.*?<\/rPh>/gs, '').matchAll(/<si>(.*?)<\/si>/gs)].map((m) => dec([...m[1]!.matchAll(/<t[^>]*>(.*?)<\/t>/gs)].map((t) => t[1]).join('')))
    : []
  const colNo = (letters: string) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1
  const grid: string[][] = []
  for (const row of sheetXml.matchAll(/<row\b[^>]*\br="(\d+)"[^>]*>(.*?)<\/row>/gs)) {
    const r = Number(row[1]) - 1
    const cells: string[] = []
    for (const c of row[2]!.matchAll(/<c\b r="([A-Z]+)\d+"([^>]*?)(?:\/>|>(.*?)<\/c>)/gs)) {
      const body = c[3] ?? ''
      const v = body.match(/<v>(.*?)<\/v>/s)?.[1] ?? body.match(/<t[^>]*>(.*?)<\/t>/s)?.[1]
      if (v === undefined) continue
      cells[colNo(c[1]!)] = /t="s"/.test(c[2]!) ? shared[Number(v)] ?? '' : dec(v)
    }
    grid[r] = cells
  }
  for (let i = 0; i < grid.length; i++) grid[i] ??= []
  return grid
}

// ---------------------------------------------------------------------------
// PDF（1 ページ）

interface Line { y: number; words: Word[] }
function toLines(ws: Word[]): Line[] {
  const lines: Line[] = []
  for (const w of [...ws].sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2)) {
    const y = (w.y0 + w.y1) / 2
    const last = lines[lines.length - 1]
    if (last && Math.abs(last.y - y) <= Math.max(2, (w.y1 - w.y0) * 0.4)) last.words.push(w)
    else lines.push({ y, words: [w] })
  }
  for (const l of lines) l.words.sort((a, b) => a.x0 - b.x0)
  return lines
}

/**
 * 単位の行（単位の語が 5 つ以上で 7 割以上）の語の中心を列の中心とする。列の境目は隣の列との中点。
 * 見出し（品目名）は単位の行より上で、表題の行（「備蓄」「時点」などを含む行）より下の語を、中心が入る列に集める。
 * 数は右寄せ・中央寄せのどちらでも、語の中心が入る列に入れる。前のページと列が同じ（単位の行がない続きのページ）なら prev を使う
 */
export function tableFromPdfPage(xml: string, prev?: { columns: TableColumn[]; centers: number[] }): Table & { centers: number[] } {
  const problems: string[] = []
  const lines = toLines(parseBboxWords(xml).filter((w) => w.text.trim()))
  const unitIdx = lines.findIndex((l) => {
    const ws = l.words.filter((w) => !/^(単位|項目)$/.test(norm(w.text)))
    const u = ws.filter((w) => isUnit(w.text)).length
    return u >= 5 && u >= ws.length * 0.7
  })
  let columns: TableColumn[]
  let centers: number[]
  let bodyFrom: number
  if (unitIdx < 0) {
    if (!prev) return { columns: [], rows: [], problems: ['単位の行がない'], centers: [] }
    columns = prev.columns; centers = prev.centers; bodyFrom = 0
  } else {
    const units = lines[unitIdx]!.words.filter((w) => isUnit(w.text))
    centers = units.map((w) => (w.x0 + w.x1) / 2)
    const bounds = boundsOf(centers)
    let top = 0
    for (let i = unitIdx - 1; i >= 0; i--) {
      if (lines[i]!.words.some((w) => /備蓄|時点|現在|基準日|公表/.test(w.text))) { top = i + 1; break }
    }
    const labelWords: Word[][] = centers.map(() => [])
    for (let i = top; i < unitIdx; i++) {
      for (const w of lines[i]!.words) {
        if (/^(番号|品目|単位|項目|物資|団体名)$/.test(norm(w.text)) || /^\d+$/.test(norm(w.text))) continue
        const k = colOf(bounds, (w.x0 + w.x1) / 2)
        if (k >= 0) labelWords[k]!.push(w)
      }
    }
    columns = units.map((u, k) => ({ label: norm(labelWords[k]!.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0).map((w) => w.text).join('')), unit: norm(u.text) }))
    bodyFrom = unitIdx + 1
  }
  const bounds = boundsOf(centers)
  const rows: TableRow[] = []
  for (const l of lines.slice(bodyFrom)) {
    const nameWords = l.words.filter((w) => w.x1 <= bounds[0]! + 2 && parseCount(w.text) === null)
    if (!nameWords.length) continue
    const name = norm(nameWords.map((w) => w.text).join(''))
    if (!name || /^\d+$/.test(name)) continue
    const values: Record<number, number> = {}
    const seen = new Set<number>()
    for (const w of l.words) {
      if (nameWords.includes(w)) continue
      const t = norm(w.text)
      if (DASH.test(t)) continue
      const n = parseCount(t)
      if (n === null) continue
      const k = numberCol(centers, w)
      if (k < 0) { problems.push(`${name}: 列が決まらない数 ${t}`); continue }
      if (seen.has(k)) { problems.push(`${name}: 列「${columns[k]!.label}」に数が 2 つ`); delete values[k]; continue }
      seen.add(k); values[k] = n
    }
    rows.push({ name, values })
  }
  return { columns, rows, problems, centers }
}

/**
 * 数の列。数は右寄せか中央寄せなので、数の右端は列の中心より右、次の列の中心より左にある。
 * 見出しが長い列は単位の中心が列の中心からずれるので、中心の中点で区切ると隣の列に入ってしまう（埼玉県の表）。
 * 右端より左にある中心のうち最も右の列とし、数の左端が次の列の中心を越えるもの・最後の列の幅を越えるものは決めない
 */
function numberCol(centers: number[], w: Word): number {
  let k = -1
  for (let i = 0; i < centers.length; i++) if (centers[i]! <= w.x1 + 1) k = i
  if (k < 0) return -1
  const next = centers[k + 1]
  if (next !== undefined && w.x0 >= next) return -1
  const width = centers.length > 1 ? (centers[centers.length - 1]! - centers[0]!) / (centers.length - 1) : Infinity
  if (next === undefined && w.x1 > centers[k]! + width) return -1
  return k
}

function boundsOf(centers: number[]): number[] {
  const b: number[] = []
  for (let i = 0; i < centers.length; i++) {
    const w = i + 1 < centers.length ? centers[i + 1]! - centers[i]! : centers[i]! - centers[i - 1]!
    const wl = i > 0 ? centers[i]! - centers[i - 1]! : w
    b.push(centers[i]! - wl / 2)
    if (i === centers.length - 1) b.push(centers[i]! + w / 2)
  }
  return b
}
function colOf(bounds: number[], x: number): number {
  for (let k = 0; k + 1 < bounds.length; k++) if (x >= bounds[k]! && x < bounds[k + 1]!) return k
  return -1
}

// ---------------------------------------------------------------------------
// 列 → 項目

export interface ItemDef { key: string; cao?: string; muni?: string[] }

/**
 * 単位の表記ゆれ（同じ数え方）。これ以外は単位が違えば比べない。
 * 「台」「基」「棟」はどれも 1 つずつ数える数え方（簡易トイレを「台」と書く県と「基」と書く県がある）
 */
export const unitKey = (u: string) => {
  const s = norm(u)
  if (s === '回' || s === '回分') return '回'
  if (s === '台' || s === '基' || s === '棟') return '台'
  return s
}

/**
 * 列の見出しの上にある、品目のまとまりの見出し（例：「暖房器具」の下に「ストーブ(石油)」）。
 * 見出しが「まとまり + 品目名」になっている列は、まとまりを外して品目名で当てる。ここにない語は外さない
 */
const GROUP_HEADS = ['毛布', 'ベッド', 'トイレ', '設置型トイレ', 'トイレットペーパー', '生理用品', 'おむつ', '暖房器具', '冷房器具', '飲料水', '飲料', '乳児用ミルク', 'パーティション', '寒冷・猛暑対応品', '避難所用品'].map(norm)
function labelNames(label: string): string[] {
  const out = [label]
  // まとまりの見出しと品目名が同じ語（例：「携帯トイレ」の下に「携帯トイレ」）
  const half = label.length / 2
  if (Number.isInteger(half) && label.slice(0, half) === label.slice(half)) out.push(label.slice(0, half))
  for (const g of GROUP_HEADS) if (label.startsWith(g) && label.length > g.length) out.push(label.slice(g.length))
  return out
}

/**
 * 列の名前（NFKC・空白なし）が項目の名前（内閣府の調査の列名か、defs の muni の別名）と一致し、
 * 単位が内閣府の調査と同じ列だけを項目に当てる。同じ項目に当たる列が 2 つ以上あれば、その項目は使わない
 */
export function mapColumns(columns: TableColumn[], defs: ItemDef[], caoUnits: Record<string, string>): { map: Map<string, number>; problems: string[] } {
  const problems: string[] = []
  const hits = new Map<string, number[]>()
  columns.forEach((c, i) => {
    const labels = labelNames(c.label)
    for (const d of defs) {
      const names = [d.cao, ...(d.muni ?? [])].filter((x): x is string => !!x).map(norm)
      if (!names.some((n) => labels.includes(n))) continue
      const cu = caoUnits[d.key]
      if (!cu || unitKey(cu) !== unitKey(c.unit)) { problems.push(`列「${c.label}」: 単位が国の調査と違う（${c.unit} / ${cu ?? 'なし'}）`); continue }
      hits.set(d.key, [...(hits.get(d.key) ?? []), i])
    }
  })
  const map = new Map<string, number>()
  for (const [k, is] of hits) {
    if (is.length === 1) map.set(k, is[0]!)
    else problems.push(`${k}: 当たる列が ${is.length} つ（${is.map((i) => columns[i]!.label).join('・')}）`)
  }
  return { map, problems }
}
