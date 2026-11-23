// 備蓄の数の表を PDF から読む（DATA_NOTES 18）。pdftotext -bbox の語の位置で列を決める。文字の並び順には頼らない。
//   1. 内閣府「災害用物資・機材等の備蓄状況に関する調査結果（令和 6 年 11 月 1 日時点）」市区町村ごとの数
//   2. 徳島県「避難所等の備蓄物資・資機材保管リスト（令和 8 年 4 月 1 日時点）」避難所ごとの数
// 空欄は「記載なし」として値を持たない（0 で埋めない）。「-」も値を持たない。

export interface Word { x0: number; y0: number; x1: number; y1: number; text: string }

export function parseBboxWords(xml: string): Word[] {
  const out: Word[] = []
  for (const m of xml.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)) {
    out.push({ x0: Number(m[1]), y0: Number(m[2]), x1: Number(m[3]), y1: Number(m[4]), text: decodeEntities(m[5]!) })
  }
  return out
}
const decodeEntities = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")

/** 「1,020」→ 1020。数でなければ null */
export function parseCount(s: string): number | null {
  const t = s.normalize('NFKC').replace(/,/g, '')
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : null
}

const joinWords = (ws: Word[]) => [...ws].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0).map((w) => w.text).join('')

// ---------------------------------------------------------------------------
// 1. 内閣府の市区町村ごとの表（1 ページに 1 都道府県の一部。列は「番号」1〜50）

export interface CaoColumn { no: number; label: string; unit: string }
/** values は列の位置（0 始まり）→ 数。列の番号の見出しは読み違いがあるので使わず、列の名前（label）で項目を決める */
export interface CaoRow { pref: string; name: string; values: Record<number, number> }

/** 「-」「―」など、数がないことを表す語 */
const DASH = /^[-‐－―—]$/

/**
 * 1 ページを読む。列の右端は「小項目コード」の行で決める（数は右寄せ）。コードの行がないページは、
 * ほかのページで測った「右端 =「番号」の中心 + 列幅 × rightRatio」を使う。数は右端がいちばん近い列に入れる
 */
export function parseCaoPage(xml: string, rightRatio?: number): { pref: string | null; columns: CaoColumn[]; rows: CaoRow[]; problems: string[]; rightRatio?: number } {
  const ws = parseBboxWords(xml)
  const problems: string[] = []
  const prefWord = ws.find((w) => w.text.startsWith('都道府県名：'))
  const pref = prefWord ? prefWord.text.replace('都道府県名：', '') : null
  const bang = ws.find((w) => w.text === '番号')
  const tani = ws.find((w) => w.text === '単位')
  const code = ws.find((w) => w.text === '小項目コード')
  if (!pref || !bang || !tani) return { pref, columns: [], rows: [], problems: pref ? ['表の見出しが見つからない'] : [] }
  const nums = ws.filter((w) => Math.abs(w.y0 - bang.y0) < 2 && /^\d+$/.test(w.text) && w.x0 > bang.x1).sort((a, b) => a.x0 - b.x0)
  const colWidth = nums.length > 1 ? (nums[nums.length - 1]!.x0 - nums[0]!.x0) / (nums.length - 1) : 90
  const center = (w: Word) => (w.x0 + w.x1) / 2
  let right: number[]
  let ratio: number | undefined
  if (code) {
    const codeWords = ws.filter((w) => /^\d{6}$/.test(w.text) && w.y0 > tani.y1 && w.y0 > code.y0 - 60 && w.y1 < code.y1 + 60)
    const rs = nums.map((n) => {
      const c = codeWords.filter((w) => w.x1 > n.x0 && w.x0 < n.x1 + colWidth * 0.7)
      return c.length ? Math.max(...c.map((w) => w.x1)) : null
    })
    const ratios = rs.flatMap((r, i) => (r === null ? [] : [(r - center(nums[i]!)) / colWidth])).sort((a, b) => a - b)
    ratio = ratios[Math.floor(ratios.length / 2)]
    right = rs.map((r, i) => r ?? center(nums[i]!) + colWidth * (ratio ?? 0.4))
  } else {
    if (rightRatio === undefined) return { pref, columns: [], rows: [], problems: ['小項目コードの行がなく、列の右端が決まらない'] }
    right = nums.map((n) => center(n) + colWidth * rightRatio)
  }
  const headBottom = code ? code.y1 : tani.y1
  const columns: CaoColumn[] = nums.map((n, i) => {
    const r = right[i]!
    const inCol = (w: Word) => w.x0 >= r - colWidth + 2 && w.x1 <= r + 4
    const label = joinWords(ws.filter((w) => w.y0 > bang.y1 && w.y1 < tani.y0 && inCol(w)))
    const unit = joinWords(ws.filter((w) => Math.abs(w.y0 - tani.y0) < 2 && inCol(w)))
    return { no: Number(n.text), label, unit }
  })
  // 行：見出しより下で、名前の欄（「番号」の列）にある語
  const names = ws.filter((w) => w.y0 > headBottom + 2 && w.x0 < bang.x1 + 30 && w.x1 < (nums[0]?.x0 ?? 300) && !/^\d+$/.test(w.text) && !w.text.startsWith('小項目'))
  const rows: CaoRow[] = []
  for (const nw of names.sort((a, b) => a.y0 - b.y0)) {
    const values: Record<number, number> = {}
    for (const w of ws.filter((w) => Math.abs(w.y0 - nw.y0) < 3 && w.x0 > nw.x1)) {
      const t = w.text.replace(/[\u200b-\u200f\u202a-\u202e]/g, '')
      if (DASH.test(t)) continue
      const v = parseCount(t)
      if (v === null) { problems.push(`${pref}${nw.text}: 数でない語「${t}」`); continue }
      let best = -1, bestD = Infinity
      right.forEach((r, i) => { const d = Math.abs(w.x1 - r); if (d < bestD) { bestD = d; best = i } })
      // 見えない制御文字が付いた数は右端が少し右に出る（例：和歌山県有田市）ので、余裕を持たせる
      if (best < 0 || bestD > (t === w.text ? 12 : 18)) { problems.push(`${pref}${nw.text}: 列が決まらない数 ${t}`); continue }
      if (values[best] !== undefined) problems.push(`${pref}${nw.text}: 列「${columns[best]!.label}」に数が 2 つ`)
      values[best] = v
    }
    rows.push({ pref, name: nw.text, values })
  }
  return { pref, columns, rows, problems, rightRatio: ratio }
}

// ---------------------------------------------------------------------------
// 2. 徳島県の避難所ごとの表

export interface TokushimaColumn { label: string; unit: string; right: number }
export interface TokushimaRow {
  no: number
  muni: string
  kind: string
  name: string
  address: string
  capacity: number | null
  /** 列の名前（見出しをつないだもの）→ 数。エアコン設備は「〇」「✕」をそのまま */
  values: Record<string, number | string>
}

/**
 * 1 ページを読む。見出しの最下行（単位：食・台・枚など）の語ごとに列を作り、列の右端は見出しの語の右端の最大値。
 * 数は右寄せなので、右端がいちばん近い列に入れる。〇・✕ は列の中央寄せなので、範囲に入る列に入れる
 */
export function parseTokushimaPage(xml: string): { columns: TokushimaColumn[]; rows: TokushimaRow[]; problems: string[] } {
  const ws = parseBboxWords(xml)
  const problems: string[] = []
  const noHead = ws.find((w) => w.text === 'No')
  const capHead = ws.find((w) => w.text === '想定')
  if (!noHead || !capHead) return { columns: [], rows: [], problems: [] }
  // 見出しの範囲：「No」の少し上から、最初の行（No の列の数）の上まで。資料によって見出しの高さが違う
  const firstRow = ws.filter((w) => w.y0 > noHead.y1 && /^\d+$/.test(w.text) && Math.abs(w.x0 - noHead.x0) < 6).sort((a, b) => a.y0 - b.y0)[0]
  const headBottom = firstRow ? firstRow.y0 - 1 : noHead.y1 + 14
  const head = ws.filter((w) => w.y0 > noHead.y0 - 16 && w.y1 < headBottom && w.x0 > capHead.x1 + 2)
  // 単位の行：見出しのいちばん下の行（「〇:有」「✕:無」の注記は除く）
  const unitY = Math.max(...head.filter((w) => !/^[〇✕○×]:/.test(w.text)).map((w) => w.y0))
  const units = head.filter((w) => Math.abs(w.y0 - unitY) < 1.5).sort((a, b) => a.x0 - b.x0)
  // エアコン設備の列は単位がなく「〇:有」「✕:無」の注記がある。注記を単位の代わりにする
  const markNote = head.find((w) => w.text.startsWith('〇:'))
  if (markNote && !units.some((u) => Math.abs(u.x0 - markNote.x0) < 6)) {
    units.push({ ...markNote, text: '〇/✕', y0: unitY }); units.sort((a, b) => a.x0 - b.x0)
  }
  // 大見出し（食料・飲料・電化製品…と「備蓄物資・資機材」）は列の名前に入れない。見出しの上のほうにある、決まった語だけを外す
  // （「トイレ」は大見出しにも、「携帯／トイレ」のような列の名前の一部にもなるので、位置でも区別する）
  const GROUP = /^(備蓄物資・資機材|食料|飲料|電化製品|空調|トイレ|ベッド・テント|衛生用品|生理用品|おむつ用品|通信機器)$/
  const headTop = Math.min(...head.map((w) => w.y0))
  const labelWords = head.filter((w) => !(GROUP.test(w.text) && w.y0 <= headTop + 7) && Math.abs(w.y0 - unitY) >= 1.5)
  const columns: TokushimaColumn[] = units.map((u, i) => {
    const c = (u.x0 + u.x1) / 2
    const lo = i > 0 ? ((units[i - 1]!.x0 + units[i - 1]!.x1) / 2 + c) / 2 : c - 8
    const hi = i < units.length - 1 ? (c + (units[i + 1]!.x0 + units[i + 1]!.x1) / 2) / 2 : c + 8
    const lw = labelWords.filter((w) => (w.x0 + w.x1) / 2 >= lo && (w.x0 + w.x1) / 2 < hi)
    return { label: joinWords(lw.filter((w) => !/^[〇✕○×]:/.test(w.text))), unit: u.text, right: Math.max(u.x1, ...lw.map((w) => w.x1)) }
  })
  const capRight = Math.max(...ws.filter((w) => ['想定', '収容', '人数'].includes(w.text) && Math.abs(w.x0 - capHead.x0) < 3).map((w) => w.x1))
  const addrHead = ws.find((w) => w.text === '所在地')
  const nameHead = ws.find((w) => w.text === '名称')
  const kindHead = ws.find((w) => w.text === '種別')
  if (!addrHead || !nameHead || !kindHead) return { columns, rows: [], problems: ['名称・所在地の見出しがない'] }
  // 列の境目：名称は「種別」の右端より右、所在地の見出しの左端 − 余白より左
  const nameLeft = kindHead.x1 + 6
  const rows: TokushimaRow[] = []
  const noWords = ws.filter((w) => w.y0 > noHead.y1 + 4 && /^\d+$/.test(w.text) && Math.abs(w.x0 - noHead.x0) < 6)
  // 行の高さの半分より近い語を同じ行とみなす（名称が 2 段に折り返す資料がある。行の間隔は資料で 4〜11pt と違う）
  const ys = noWords.map((w) => w.y0).sort((a, b) => a - b)
  const gaps = ys.slice(1).map((y, i) => y - ys[i]!).filter((g) => g > 1).sort((a, b) => a - b)
  const tol = Math.min(5, (gaps[Math.floor(gaps.length / 2)] ?? 4) * 0.45)
  const lineOf = (nw: Word) => ws.filter((w) => Math.abs((w.y0 + w.y1) / 2 - (nw.y0 + nw.y1) / 2) < tol && w !== nw).sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)
  const KIND = /^(指定避難所|避難所|福祉避難所|備蓄倉庫|物資拠点)/
  // 所在地の欄の左端：各行で、名称より右にあって市町村名（または「○○郡」）から始まる最初の語の左端の最小値
  const addrStarts = noWords.flatMap((nw) => {
    const line = lineOf(nw)
    const muni = line.find((w) => w.x1 < kindHead.x0)?.text ?? ''
    const a = line.find((w) => w.x0 > nameLeft + 10 && (w.text.startsWith(muni) || /^.{1,4}郡/.test(w.text)) && w.x0 > nameHead.x0)
    return a ? [a.x0] : []
  })
  const addrLeft = addrStarts.length ? Math.min(...addrStarts) : addrHead.x0 - 20
  for (const nw of noWords) {
    const line = lineOf(nw)
    const muni = line.find((w) => w.x1 < kindHead.x0 && !/^\d+$/.test(w.text))?.text ?? ''
    const kindWord = line.find((w) => KIND.test(w.text) && w.x0 < nameHead.x0)
    const kind = kindWord?.text ?? ''
    const left = Math.max(nameLeft, kindWord ? kindWord.x1 + 1 : 0)
    const nameWords = line.filter((w) => w.x0 >= left && w.x0 < addrLeft - 0.5)
    const addrWords = line.filter((w) => w.x0 >= addrLeft - 0.5 && w.x1 < capHead.x0 - 2)
    const capWord = line.find((w) => w.x0 >= capHead.x0 - 10 && w.x1 <= capRight + 8 && parseCount(w.text) !== null)
    const values: Record<string, number | string> = {}
    for (const w of line.filter((w) => w.x0 > capRight + 1 && w !== capWord)) {
      if (DASH.test(w.text) || w.text === 'ー') continue
      let best = -1, bestD = Infinity
      const mark = /^[〇✕○×]$/.test(w.text)
      columns.forEach((c, i) => {
        const d = mark ? Math.abs((w.x0 + w.x1) / 2 - (c.right - 5)) : Math.abs(w.x1 - c.right)
        if (d < bestD) { bestD = d; best = i }
      })
      if (best < 0 || bestD > 7) { problems.push(`${muni}${joinWords(nameWords)}: 列が決まらない「${w.text}」`); continue }
      const key = `${columns[best]!.label}（${columns[best]!.unit}）`
      const v = mark ? (w.text === '○' ? '〇' : w.text === '×' ? '✕' : w.text) : parseCount(w.text)
      if (v === null) { problems.push(`${muni}${joinWords(nameWords)}: 数でない語「${w.text}」`); continue }
      if (values[key] !== undefined) problems.push(`${muni}${joinWords(nameWords)}: 列「${key}」に値が 2 つ`)
      values[key] = v
    }
    rows.push({
      no: Number(nw.text), muni, kind,
      name: nameWords.map((w) => w.text).join(' '),
      address: addrWords.map((w) => w.text).join(''),
      capacity: capWord ? parseCount(capWord.text) : null,
      values,
    })
  }
  return { columns, rows, problems }
}
