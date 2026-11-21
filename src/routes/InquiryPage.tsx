import { Link } from '@tanstack/react-router'
import type { InquirySummaryFile } from '../../shared/inquiry.ts'
import { Status } from '../components/Layout.tsx'
import { fmt, ja } from '../i18n/ja.ts'
import { useInquiries } from '../lib/data.ts'

type MuniRow = InquirySummaryFile['munis'][number]

/** 照会の記録（docs/INQUIRY.md 4 章）。都道府県ごとに並べる。順位・点数は付けない */
export function InquiryPage() {
  const q = useInquiries()
  const t = ja.inquiry
  const d = q.data
  const byPref = new Map<string, MuniRow[]>()
  for (const m of d?.munis ?? []) byPref.set(m.pref, [...(byPref.get(m.pref) ?? []), m])
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-5">
      <nav aria-label={ja.list.breadcrumb} className="text-base leading-loose [&_a]:inline-block [&_a]:py-1.5">
        <Link to="/list">{ja.list.top}</Link>{' › '}<span aria-current="page">{t.title}</span>
      </nav>
      <h1 className="m-0 mt-1 text-2xl font-bold">{t.title}</h1>
      <p className="text-base">{t.intro}</p>
      <Status loading={q.isLoading} error={q.isError} />
      {d && (
        <>
          <section className="rounded border border-line bg-surface p-3 text-base">
            <h2 className="m-0 text-lg font-bold">{t.conditionTitle}</h2>
            <p className="m-0 mt-1">{t.condition(d.condition)}</p>
            <p className="m-0 mt-1">{t.asked}</p>
            <p className="m-0 mt-1 text-sm text-ink-soft">{t.conditionSource}</p>
          </section>
          <ul className="m-0 mt-3 flex list-none flex-wrap gap-2 p-0 text-sm">
            {Object.entries(d.counts).filter(([, n]) => n > 0).map(([s, n]) => (
              <li key={s} className="rounded-full border border-line bg-surface px-3 py-1">{t.status[s]}：<span className="font-bold tabular-nums">{fmt.format(n)}</span></li>
            ))}
          </ul>
          <div className="mt-3 space-y-2">
            {[...byPref].map(([pref, munis]) => (
              <details key={pref} className="group rounded border border-line bg-surface" open={munis.some((m) => m.events.length > 0)}>
                <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 text-lg font-bold">
                  <span>{pref}</span>
                  <span className="flex items-center gap-3 text-sm font-normal text-ink-soft tabular-nums">
                    {munis.length}
                    <span aria-hidden="true" className="text-lg group-open:rotate-90">›</span>
                  </span>
                </summary>
                <ul className="m-0 list-none border-t border-line px-4 py-1">
                  {munis.map((m) => <InquiryMuni key={m.key} m={m} />)}
                </ul>
              </details>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function InquiryMuni({ m }: { m: MuniRow }) {
  const t = ja.inquiry
  return (
    <li id={m.key} className="scroll-mt-20 border-b border-line py-2.5 last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-base font-bold">{m.name}</span>
        <span className={`rounded px-2 text-sm ${m.status === 'not_sent' ? 'border border-dashed border-line text-ink-soft' : 'border border-ink font-bold'}`}>{t.status[m.status]}</span>
      </div>
      <InquiryEvents m={m} />
    </li>
  )
}

/** 出来事の並び。市町村の一覧ページからも使う */
export function InquiryEvents({ m }: { m: MuniRow }) {
  const t = ja.inquiry
  if (m.events.length === 0) return null
  return (
    <>
      <ol className="m-0 mt-1 list-none space-y-1 p-0 text-sm">
        {m.events.map((e, i) => (
          <li key={i}>
            <span className="tabular-nums text-ink-soft">{e.date}</span>{' '}
            <strong>{t.eventType[e.type]}</strong>
            {e.channel && <span className="text-ink-soft">（{t.channel[e.channel]}）</span>}
            {e.summary && <span>：{e.summary}</span>}
            {e.files?.map((f) => (
              <span key={f.name} className="ml-1">{f.url ? <a href={f.url} target="_blank" rel="noreferrer">［{f.name}］</a> : `［${f.name}］`}</span>
            ))}
          </li>
        ))}
      </ol>
      {m.facilities_with_values > 0 && <p className="m-0 mt-1 text-sm">{t.valuesCount(m.facilities_with_values)}</p>}
    </>
  )
}

/** 市町村の施設一覧ページに出す「この市町村への照会」。照会先の候補か、記録がある市町村だけ */
export function MuniInquirySection({ muniKey }: { muniKey: string }) {
  const q = useInquiries()
  const m = q.data?.munis.find((x) => x.key === muniKey)
  if (!m) return null
  const t = ja.inquiry
  return (
    <section aria-label={t.muniSection} className="mt-2 rounded border border-line bg-surface p-3 text-base">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="m-0 text-base font-bold">{t.muniSection}</h2>
        <span className="text-sm">{t.status[m.status]}</span>
      </div>
      {m.target && <p className="m-0 text-sm text-ink-soft">{t.targetNote}</p>}
      {m.events.length === 0 ? <p className="m-0 mt-1 text-sm text-ink-soft">{t.noEvents}</p> : <InquiryEvents m={m} />}
      <p className="m-0 mt-1 text-sm"><Link to="/inquiries" hash={m.key}>{t.link}</Link></p>
    </section>
  )
}
