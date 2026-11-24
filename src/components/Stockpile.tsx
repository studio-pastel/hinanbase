// 備蓄の数（DATA_NOTES 18・19）。項目は config/stockpile-defs.json から作る（画面に項目名を直接書かない）。
// 資料に記載がない項目は出さない（0 とは書かない）。
import defs from '../../config/stockpile-defs.json'
import { compareStockpile } from '../../shared/stockpileChange.ts'
import type { StockpileBlock } from '../../shared/types.ts'
import { fmt, ja } from '../i18n/ja.ts'

const groups: { key: string; label_ja: string }[] = defs.groups
const items: { key: string; group: string; label_ja: string }[] = defs.items

function valueText(b: StockpileBlock, key: string): string | null {
  const v = b.values[key]
  if (v === undefined) return null
  if (v === '〇') return ja.stockpile.markYes
  if (v === '✕') return ja.stockpile.markNo
  return typeof v === 'number' ? `${fmt.format(v)} ${b.units[key] ?? ''}`.trim() : String(v)
}

/** 項目のまとまりごとの表。記載のある項目だけ */
export function StockpileGrid({ block }: { block: StockpileBlock }) {
  const rows = groups
    .map((g) => ({ g, list: items.filter((i) => i.group === g.key).flatMap((i) => { const t = valueText(block, i.key); return t ? [{ i, t }] : [] }) }))
    .filter((x) => x.list.length > 0)
  if (rows.length === 0) return <p className="m-0 mt-1 text-sm text-ink-soft">{ja.stockpile.none}</p>
  return (
    <dl className="m-0 mt-2 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
      {rows.map(({ g, list }) => (
        <div key={g.key}>
          <dt className="text-sm font-bold">{g.label_ja}</dt>
          <dd className="m-0">
            <ul className="m-0 list-none p-0 text-base">
              {list.map(({ i, t }) => (
                <li key={i.key} className="flex justify-between gap-3 border-b border-line py-0.5 last:border-b-0">
                  <span>{i.label_ja}</span>
                  <span className="tabular-nums">{t}</span>
                </li>
              ))}
            </ul>
          </dd>
        </div>
      ))}
    </dl>
  )
}

export function StockpileSourceNote({ block }: { block: StockpileBlock }) {
  const s = block.source
  return (
    <p className="m-0 mt-2 text-sm text-ink-soft">
      {ja.stockpile.source}：<a href={s.url} target="_blank" rel="noreferrer">{s.publisher}「{s.title}」</a>（{s.as_of}）。{s.note}
    </p>
  )
}

/** 国の調査の数と、その後に都道府県が公表した数を品目ごとに並べる（DATA_NOTES 20） */
export function StockpileChange({ base, later }: { base: StockpileBlock; later: StockpileBlock }) {
  const t = ja.stockpile
  const rows = compareStockpile(items.map((i) => i.key), base.values, later.values)
  if (rows.length === 0) return null
  const label = new Map(items.map((i) => [i.key, i.label_ja]))
  const num = (n: number, key: string) => `${fmt.format(n)} ${base.units[key] ?? ''}`.trim()
  return (
    <div className="mt-3 border-t border-line pt-2">
      <h3 className="m-0 text-base font-bold">{t.changeTitle}</h3>
      <p className="m-0 mt-1 text-sm">{t.changeIntro(later.source.publisher)}</p>
      <p className="m-0 mt-2 text-sm font-bold">{t.changeOrder(base.source.as_of, base.source.publisher, later.source.as_of, later.source.publisher)}</p>
      <ul className="m-0 mt-1 list-none p-0 sm:grid sm:grid-cols-2 sm:gap-x-6">
        {rows.map((r) => (
          <li key={r.key} className="border-b border-line py-1">
            <div className="flex justify-between gap-3">
              <span>{label.get(r.key)}</span>
              <span className="whitespace-nowrap font-bold tabular-nums">
                {r.kind === 'same' ? t.same : r.kind === 'check' ? t.check : r.kind === 'up' ? t.up(fmt.format(r.diff!)) : t.down(fmt.format(-r.diff!))}
              </span>
            </div>
            <div className="text-sm tabular-nums text-ink-soft">{num(r.before, r.key)} → {num(r.after, r.key)}</div>
          </li>
        ))}
      </ul>
      <p className="m-0 mt-2 text-sm text-ink-soft">{t.changeNote}</p>
      <p className="m-0 mt-1 text-sm text-ink-soft">
        {t.source}：<a href={later.source.page ?? later.source.url} target="_blank" rel="noreferrer">{later.source.publisher}「{later.source.title}」</a>
      </p>
    </div>
  )
}

/** 市区町村の一覧ページ・施設ページで使う「市区町村全体の備蓄」 */
export function MuniStockpileSection({ block, yearly, shelters, collapsed = false }: { block: StockpileBlock | undefined; yearly?: StockpileBlock[]; shelters?: number; collapsed?: boolean }) {
  const t = ja.stockpile
  const latest = yearly?.[yearly.length - 1]
  if (!block && !latest) return null
  const body = (
    <>
      <p className="m-0 mt-1 text-sm">{t.muniNote}{shelters !== undefined && t.shelterCount(shelters)}</p>
      {block ? (
        <>
          <StockpileGrid block={block} />
          <StockpileSourceNote block={block} />
          {latest && <StockpileChange base={block} later={latest} />}
        </>
      ) : (
        <>
          <StockpileGrid block={latest!} />
          <StockpileSourceNote block={latest!} />
        </>
      )}
    </>
  )
  if (collapsed) {
    return (
      <details className="mt-3 rounded border border-line bg-surface">
        <summary className="flex min-h-12 cursor-pointer items-center px-3 text-base font-bold">{t.muniTitle}</summary>
        <div className="border-t border-line px-3 pb-3">{body}</div>
      </details>
    )
  }
  return (
    <section aria-label={t.muniTitle} className="mt-2 rounded border border-line bg-surface p-3">
      <h2 className="m-0 text-base font-bold">{t.muniTitle}</h2>
      {body}
    </section>
  )
}

/** 施設ページの「この避難所の備蓄」。一覧の行が複数（体育館と校舎など）なら行ごとに出す */
export function FacilityStockpileSection({ blocks }: { blocks: StockpileBlock[] | undefined }) {
  const t = ja.stockpile
  if (!blocks?.length) return null
  return (
    <section aria-label={t.facilityTitle} className="mt-4 rounded border border-line bg-surface p-3">
      <h2 className="m-0 text-lg font-bold">{t.facilityTitle}</h2>
      {blocks.map((b, i) => (
        <div key={i} className={i > 0 ? 'mt-3 border-t border-line pt-2' : ''}>
          <p className="m-0 mt-1 text-sm">{t.listRow(b.list_name ?? '', b.list_capacity ?? null)}</p>
          <StockpileGrid block={b} />
        </div>
      ))}
      <StockpileSourceNote block={blocks[0]!} />
    </section>
  )
}
