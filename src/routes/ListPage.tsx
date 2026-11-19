import { Link, useParams } from '@tanstack/react-router'
import { useState } from 'react'
import { Status } from '../components/Layout.tsx'
import { StateLabel } from '../components/StateMark.tsx'
import { fmt, ja } from '../i18n/ja.ts'
import { useEvacueeEstimates, useMuni, useMuniIndex } from '../lib/data.ts'

/** 地方区分（都道府県コード） */
const REGIONS: { name: string; codes: number[] }[] = [
  { name: '北海道', codes: [1] },
  { name: '東北', codes: [2, 3, 4, 5, 6, 7] },
  { name: '関東', codes: [8, 9, 10, 11, 12, 13, 14] },
  { name: '中部', codes: [15, 16, 17, 18, 19, 20, 21, 22, 23] },
  { name: '近畿', codes: [24, 25, 26, 27, 28, 29, 30] },
  { name: '中国', codes: [31, 32, 33, 34, 35] },
  { name: '四国', codes: [36, 37, 38, 39] },
  { name: '九州・沖縄', codes: [40, 41, 42, 43, 44, 45, 46, 47] },
]

function Shell({ title, crumbs, children }: { title: string; crumbs: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-5">
      <nav aria-label={ja.list.breadcrumb} className="text-base leading-loose [&_a]:inline-block [&_a]:py-1.5">{crumbs}</nav>
      <h1 className="m-0 mt-1 text-2xl font-bold">{title}</h1>
      {children}
    </div>
  )
}

export function ListPrefsPage() {
  const index = useMuniIndex()
  return (
    <Shell title={ja.list.title} crumbs={<span aria-current="page">{ja.list.top}</span>}>
      <p className="text-base text-ink-soft">{ja.list.intro}</p>
      <Status loading={index.isLoading} error={index.isError} />
      {index.data && (
        // まず地方で分け、開いた地方の都道府県を出す（スマホで 47 件を一度に並べない）
        <div className="mt-2 space-y-2">
          {REGIONS.map((r) => {
            const prefs = index.data.prefs.filter((p) => r.codes.includes(Number(p.code)))
            const total = prefs.reduce((n, p) => n + p.count, 0)
            return (
              <details key={r.name} className="group rounded border border-line bg-surface">
                <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 text-lg font-bold">
                  <span>{r.name}</span>
                  <span className="flex items-center gap-3 text-sm font-normal text-ink-soft tabular-nums">
                    {fmt.format(total)}{ja.unitCount}
                    <span aria-hidden="true" className="text-lg group-open:rotate-90">›</span>
                  </span>
                </summary>
                <ul className="m-0 grid list-none grid-cols-1 gap-x-6 border-t border-line px-4 pb-1 min-[420px]:grid-cols-2 sm:grid-cols-3">
                  {prefs.map((p) => (
                    <li key={p.code} className="flex min-h-12 items-center justify-between gap-2 border-b border-line last:border-b-0">
                      <Link to="/list/$prefCode" params={{ prefCode: p.code }} className="flex-1 py-2.5">{p.name}</Link>{' '}
                      <span className="text-sm text-ink-soft tabular-nums">{fmt.format(p.count)}{ja.unitCount}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )
          })}
        </div>
      )}
    </Shell>
  )
}

export function ListMunisPage() {
  const { prefCode } = useParams({ from: '/list/$prefCode' })
  const index = useMuniIndex()
  const pref = index.data?.prefs.find((p) => p.code === prefCode)
  const [sort, setSort] = useState<'code' | 'deep3'>('code')
  return (
    <Shell
      title={pref?.name ?? ja.list.munis}
      crumbs={<><Link to="/list">{ja.list.top}</Link>{' › '}<span aria-current="page">{pref?.name ?? prefCode}</span></>}
    >
      <Status loading={index.isLoading} error={index.isError} />
      {index.data && !pref && <p role="alert">{ja.notFound}</p>}
      {pref && (
        <>
          <p className="text-base text-ink-soft">{ja.list.muniNote}</p>
          {pref.munis.some((m) => m.shelters !== undefined) && (
            <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
              <span className="font-bold">{ja.list.sortLabel}</span>
              {(['code', 'deep3'] as const).map((k) => (
                <button key={k} type="button" aria-pressed={sort === k} onClick={() => setSort(k)}
                  className={sort === k ? 'min-h-9 rounded border-2 border-ink bg-ink px-3 font-bold text-white' : 'min-h-9 rounded border-2 border-line bg-white px-3'}>
                  {ja.list.sort[k]}
                </button>
              ))}
            </div>
          )}
          <ul className="m-0 grid list-none grid-cols-1 gap-x-6 p-0 sm:grid-cols-2">
            {[...pref.munis].sort((a, b) => (sort === 'deep3' ? (b.deep3 ?? 0) - (a.deep3 ?? 0) : 0)).map((m) => (
              <li key={m.key} className="border-b border-line py-1.5">
                <div className="flex min-h-10 items-center justify-between gap-2">
                  <Link to="/list/$prefCode/$muniKey" params={{ prefCode, muniKey: m.key }} className="flex-1 py-1">{m.name}</Link>{' '}
                  <span className="text-sm text-ink-soft tabular-nums">{fmt.format(m.count)}{ja.unitCount}</span>
                </div>
                {m.shelters !== undefined && m.shelters > 0 && (
                  <p className="m-0 text-sm text-ink-soft tabular-nums">{ja.list.muniStats(m.shelters, m.deep3 ?? 0, m.landslide ?? 0)}</p>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-ink-soft">{ja.list.muniStatsNote}</p>
        </>
      )}
    </Shell>
  )
}

export function ListFacilitiesPage() {
  const { prefCode, muniKey } = useParams({ from: '/list/$prefCode/$muniKey' })
  const muni = useMuni(muniKey)
  const d = muni.data
  // 地図の「想定区域と重なる施設だけを表示」と同じ絞り込み（地図を使わない経路でも同じ情報に届くように）
  const [overlapOnly, setOverlapOnly] = useState(false)
  const isOverlap = (f: NonNullable<typeof d>['facilities'][number]) => f.scores.hazard_check?.status === 'attention'
  const overlapCount = d ? d.facilities.filter(isOverlap).length : 0
  const shown = d ? (overlapOnly ? d.facilities.filter(isOverlap) : d.facilities) : []
  return (
    <Shell
      title={d ? `${d.pref_name}${d.muni_name}` : ja.list.facilities}
      crumbs={
        <>
          <Link to="/list">{ja.list.top}</Link>{' › '}
          <Link to="/list/$prefCode" params={{ prefCode }}>{d?.pref_name ?? prefCode}</Link>{' › '}
          <span aria-current="page">{d?.muni_name ?? muniKey}</span>
        </>
      }
    >
      <Status loading={muni.isLoading} error={muni.isError} />
      {d && (
        <>
          <p className="m-0 mt-2 text-base text-ink-soft">{fmt.format(d.facilities.length)} {ja.unitFacilities}</p>
          <EvacueeEstimate prefCode={prefCode} muniKey={muniKey} />
          {overlapCount > 0 && (
            <div className="mt-2 rounded border border-line bg-surface p-3 text-base">
              <p className="m-0">{ja.list.overlapCount(overlapCount)}</p>
              <label className="mt-1 flex min-h-11 items-center gap-2 font-bold">
                <input type="checkbox" className="size-5" checked={overlapOnly} onChange={(e) => setOverlapOnly(e.target.checked)} />
                {ja.list.overlapOnly}
              </label>
              <p className="m-0 mt-1 text-sm text-ink-soft">{ja.list.overlapNote}</p>
            </div>
          )}
          {shown.length === 0 && <p role="status">{ja.list.noMatch}</p>}
          <ul className="m-0 list-none p-0">
            {shown.map((f) => {
              const s = f.designations.shelter
              const restrictedOnly = s.length > 0 && s.every((x) => x.restricted)
              return (
                <li key={f.id} className="border-b border-line py-3">
                  <Link to="/f/$muniKey/$facilityId" params={{ muniKey, facilityId: f.id }} className="block py-1 text-lg font-bold">{f.name}</Link>
                  <div className="text-base text-ink-soft">{f.address}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <StateLabel state={f.scores.display_state} restrictedOnly={restrictedOnly} />
                    {f.designations.emergency_site.length > 0 && <span className="rounded border border-line px-1.5">{ja.kind.emergency}</span>}
                    {s.length > 0 && <span className="rounded border border-line px-1.5">{ja.kind.shelter}</span>}
                    {restrictedOnly && <span className="rounded border border-ink px-1.5 font-bold">{ja.kind.restrictedShort}</span>}
                  </div>
                  {(isOverlap(f) || (f.road && f.road.distance_m !== null && f.road.land !== 'no_road')) && (
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                      {isOverlap(f) && (
                        <span className="rounded border-2 border-state-critical px-1.5 font-bold">
                          <span aria-hidden="true">! </span>
                          {ja.list.overlapBadge(f.scores.hazard_check.overlap.map((k) => ja.hazard.names[k]).join('、'))}
                        </span>
                      )}
                      {f.road && f.road.distance_m !== null && f.road.land !== 'no_road' && <span className="text-ink-soft">{ja.list.roadBadge(f.road.distance_m)}</span>}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
          {d.facilities.some((f) => f.road) && <p className="mt-3 text-sm text-ink-soft">{ja.list.roadSource}</p>}
        </>
      )}
    </Shell>
  )
}

/** 都道府県の地震被害想定で公表されている避難者数を、出典付きで引用する（DATA_NOTES 12.24）。本サービスの推定ではない */
function EvacueeEstimate({ prefCode, muniKey }: { prefCode: string; muniKey: string }) {
  const q = useEvacueeEstimates()
  const t = ja.list.evacuee
  if (!q.data) return null
  const pref = q.data.prefs[prefCode]
  const muni = pref?.munis[muniKey]
  if (!pref || !muni) return <p className="m-0 mt-3 text-sm text-ink-soft">{t.none}</p>
  // 列（時点 × 区分）を、時点ごとの行にまとめる
  const times = [...new Set(pref.columns.map((c) => c.time))]
  const kinds = [...new Set(pref.columns.map((c) => c.kind))]
  const cell = (time: string, kind: string) => {
    const i = pref.columns.findIndex((c) => c.time === time && c.kind === kind)
    if (i < 0) return '—'
    const v = muni.values[i] ?? null
    return v === null ? t.notNumeric : `${fmt.format(v)} ${t.unit}`
  }
  return (
    <section aria-labelledby="evacuee-h" className="mt-3 rounded border border-line bg-surface p-3 text-base">
      <h2 id="evacuee-h" className="m-0 text-lg font-bold">{t.title}</h2>
      <p className="m-0 mt-1 text-sm">{t.intro(pref.publisher)}</p>
      <p className="m-0 mt-1 text-sm font-bold">{t.scenario(pref.scenario, pref.condition)}</p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th scope="col" className="border-b border-line py-1 pr-3 text-left font-normal text-ink-soft">{t.time}</th>
              {kinds.map((k) => <th key={k} scope="col" className="border-b border-line py-1 pr-3 text-right font-normal text-ink-soft">{k}</th>)}
            </tr>
          </thead>
          <tbody>
            {times.map((time) => (
              <tr key={time}>
                <th scope="row" className="py-1 pr-3 text-left font-normal">{time}</th>
                {kinds.map((k) => <td key={k} className="py-1 pr-3 text-right tabular-nums">{cell(time, k)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="m-0 mt-2 list-disc pl-5 text-sm text-ink-soft">
        {t.notes.map((n) => <li key={n}>{n}</li>)}
        {t.chosen(pref.other_scenario_count, pref.publisher) && <li>{t.chosen(pref.other_scenario_count, pref.publisher)}</li>}
        {pref.note && <li>{pref.note}</li>}
      </ul>
      <p className="m-0 mt-2 text-sm text-ink-soft">
        {t.source(pref.title, pref.publisher, pref.published)}{' '}
        <a href={pref.url} target="_blank" rel="noreferrer">{t.openSource}</a>
      </p>
    </section>
  )
}
