import { Link, useParams } from '@tanstack/react-router'
import { Status } from '../components/Layout.tsx'
import { StateLabel } from '../components/StateMark.tsx'
import { fmt, ja } from '../i18n/ja.ts'
import { useMuni, useMuniIndex } from '../lib/data.ts'

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
        <ul className="m-0 grid list-none grid-cols-1 gap-x-6 p-0 min-[420px]:grid-cols-2 sm:grid-cols-3">
          {index.data.prefs.map((p) => (
            <li key={p.code} className="flex min-h-12 items-center justify-between gap-2 border-b border-line">
              <Link to="/list/$prefCode" params={{ prefCode: p.code }} className="flex-1 py-2.5">{p.name}</Link>{' '}
              <span className="text-sm text-ink-soft tabular-nums">{fmt.format(p.count)}{ja.unitCount}</span>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  )
}

export function ListMunisPage() {
  const { prefCode } = useParams({ from: '/list/$prefCode' })
  const index = useMuniIndex()
  const pref = index.data?.prefs.find((p) => p.code === prefCode)
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
          <ul className="m-0 grid list-none grid-cols-1 gap-x-6 p-0 min-[420px]:grid-cols-2 sm:grid-cols-3">
            {pref.munis.map((m) => (
              <li key={m.key} className="flex min-h-12 items-center justify-between gap-2 border-b border-line">
                <Link to="/list/$prefCode/$muniKey" params={{ prefCode, muniKey: m.key }} className="flex-1 py-2.5">{m.name}</Link>{' '}
                <span className="text-sm text-ink-soft tabular-nums">{fmt.format(m.count)}{ja.unitCount}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Shell>
  )
}

export function ListFacilitiesPage() {
  const { prefCode, muniKey } = useParams({ from: '/list/$prefCode/$muniKey' })
  const muni = useMuni(muniKey)
  const d = muni.data
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
          <p className="text-base text-ink-soft">{fmt.format(d.facilities.length)} {ja.unitFacilities}</p>
          <ul className="m-0 list-none p-0">
            {d.facilities.map((f) => {
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
                </li>
              )
            })}
          </ul>
        </>
      )}
    </Shell>
  )
}
