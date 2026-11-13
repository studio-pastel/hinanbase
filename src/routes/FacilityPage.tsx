import { Link, useParams } from '@tanstack/react-router'
import { HAZARD_KEYS, type Facility } from '../../shared/types.ts'
import { Status } from '../components/Layout.tsx'
import { MapView } from '../components/MapView.tsx'
import { StateLabel } from '../components/StateMark.tsx'
import { ja } from '../i18n/ja.ts'
import { amenityCategories, formatAmenity } from '../lib/amenities.ts'
import { useMeta, useMuni } from '../lib/data.ts'

const AXES = ['hazard', 'capacity', 'habitability', 'logistics'] as const

export function FacilityPage() {
  const { muniKey, facilityId } = useParams({ from: '/f/$muniKey/$facilityId' })
  const muni = useMuni(muniKey)
  const meta = useMeta()
  const invalid = !/^\d{5}$/.test(muniKey)
  if (!invalid && !muni.data) return <Status loading={muni.isLoading} error={muni.isError} />
  const facility = muni.data?.facilities.find((f) => f.id === facilityId)
  if (!facility || !muni.data) {
    return (
      <div className="mx-auto w-full max-w-3xl p-4">
        <p role="alert">{ja.facility.notFound}</p>
        <p><Link to="/">{ja.backToMap}</Link></p>
      </div>
    )
  }
  const restrictedOnly = facility.designations.shelter.length > 0 && facility.designations.shelter.every((s) => s.restricted)
  // 経路案内は API キー不要の外部リンクで開く（SPEC §5.3）
  const routeUrl = `https://www.google.com/maps/dir/?api=1&destination=${facility.lat},${facility.lng}`

  return (
    <article className="mx-auto w-full max-w-3xl space-y-6 px-4 py-5">
      <nav aria-label={ja.list.breadcrumb} className="text-sm">
        <Link to="/list">{ja.list.top}</Link>
        {' › '}
        <Link to="/list/$prefCode" params={{ prefCode: muni.data.pref_code }}>{muni.data.pref_name}</Link>
        {' › '}
        <Link to="/list/$prefCode/$muniKey" params={{ prefCode: muni.data.pref_code, muniKey }}>{muni.data.muni_name}</Link>
      </nav>

      <header>
        <h1 className="m-0 text-2xl font-bold leading-snug">{facility.name}</h1>
        <p className="m-0 mt-1"><StateLabel state={facility.scores.display_state} restrictedOnly={restrictedOnly} /></p>
        <dl className="m-0 mt-2 text-sm">
          <dt className="sr-only">{ja.facility.address}</dt>
          <dd className="m-0">{facility.address}</dd>
        </dl>
        <p className="m-0 mt-2 text-sm">
          <a href={routeUrl} target="_blank" rel="noopener noreferrer">{ja.facility.openRoute}</a>
        </p>
      </header>

      <MapView
        mode="single"
        lat={facility.lat}
        lng={facility.lng}
        state={facility.scores.display_state}
        restrictedOnly={restrictedOnly}
        className="h-56 w-full rounded border border-line"
        label={ja.facility.mapLabel}
      />

      <Designations facility={facility} />
      <ScoreBars facility={facility} />
      <Amenities facility={facility} />

      <section aria-labelledby="source-h" className="rounded border border-line bg-surface p-4 text-sm">
        <h2 id="source-h" className="m-0 mb-2 text-base font-bold">{ja.facility.source}</h2>
        <p className="m-0">{ja.facility.sourceText}</p>
        {meta.data && <p className="m-0">{ja.facility.fetchedDate}：{meta.data.d1_fetched_date}</p>}
        <p className="m-0 mt-2 font-bold">{ja.facility.cityNote}</p>
        <p className="m-0 mt-2">{ja.facility.kindNote}</p>
        {facility.merge_rules.length > 0 && <p className="m-0 mt-2 text-ink-soft">{ja.facility.mergeNote}</p>}
      </section>
    </article>
  )
}

function Designations({ facility }: { facility: Facility }) {
  const { emergency_site, shelter } = facility.designations
  return (
    <section aria-labelledby="desig-h">
      <h2 id="desig-h" className="m-0 mb-2 text-lg font-bold">{ja.facility.designations}</h2>
      <div className="space-y-3">
        <div className="rounded border border-line bg-surface p-4">
          <h3 className="m-0 text-base font-bold">{ja.kind.emergency}</h3>
          <p className="m-0 text-xs text-ink-soft">{ja.kind.emergencyHelp}</p>
          {emergency_site.length === 0 && <p className="m-0 mt-2 text-sm">{ja.kind.none}</p>}
          {emergency_site.map((d) => (
            <div key={d.source_id} className="mt-3 border-t border-line pt-3 first-of-type:border-t-0">
              <p className="m-0 text-sm font-bold">{d.name}</p>
              <ul className="m-0 mt-1.5 flex list-none flex-wrap gap-1.5 p-0 text-xs">
                {HAZARD_KEYS.map((k) => (
                  <li
                    key={k}
                    className={
                      d.hazards[k]
                        ? 'rounded border border-ink bg-ink px-1.5 py-0.5 text-white'
                        : 'rounded border border-dashed border-line px-1.5 py-0.5 text-ink-soft'
                    }
                  >
                    {ja.hazard.names[k]}
                    <span className="sr-only">：{d.hazards[k] ? ja.hazard.designated : ja.hazard.notDesignated}</span>
                    <span aria-hidden="true">{d.hazards[k] ? ' ✓' : ' −'}</span>
                  </li>
                ))}
              </ul>
              <Extra label={ja.kind.noteLabel} value={d.note} />
              <SourceId id={d.source_id} />
            </div>
          ))}
        </div>
        <div className="rounded border border-line bg-surface p-4">
          <h3 className="m-0 text-base font-bold">{ja.kind.shelter}</h3>
          <p className="m-0 text-xs text-ink-soft">{ja.kind.shelterHelp}</p>
          {shelter.length === 0 && <p className="m-0 mt-2 text-sm">{ja.kind.none}</p>}
          {shelter.map((d) => (
            <div key={d.source_id} className="mt-3 border-t border-line pt-3 first-of-type:border-t-0">
              <p className="m-0 text-sm font-bold">{d.name}</p>
              {d.restricted && (
                <p className="m-0 mt-1.5 rounded border-2 border-ink p-2 text-sm">
                  <strong>{ja.kind.restricted}</strong>
                  <br />
                  {ja.kind.targetLabel}：{d.target ?? ja.kind.targetMissing}
                </p>
              )}
              <Extra label={ja.kind.otherLabel} value={d.other} />
              <Extra label={ja.kind.noteLabel} value={d.note} />
              <SourceId id={d.source_id} />
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function Extra({ label, value }: { label: string; value: string | null }) {
  if (value === null) return null
  return <p className="m-0 mt-1.5 text-sm"><span className="text-ink-soft">{label}：</span>{value}</p>
}
function SourceId({ id }: { id: string }) {
  return <p className="m-0 mt-1 text-xs text-ink-soft">{ja.kind.sourceIdLabel}：{id}</p>
}

function ScoreBars({ facility }: { facility: Facility }) {
  const { scores } = facility
  return (
    <section aria-labelledby="scores-h">
      <h2 id="scores-h" className="m-0 text-lg font-bold">{ja.facility.scores}</h2>
      <p className="m-0 mb-2 text-xs text-ink-soft">{ja.facility.scoresNote}</p>
      <dl className="m-0 space-y-2 rounded border border-line bg-surface p-4">
        {AXES.map((axis) => {
          const v = scores[axis]
          return (
            <div key={axis} className="grid grid-cols-[9rem_1fr] items-center gap-3 text-sm">
              <dt>{ja.facility.axes[axis]}</dt>
              <dd className="m-0">
                {v === null ? (
                  // 未評価は 0 点に見せない：空のバーではなく、斜線の帯と文字で示す
                  <div className="axis-unrated flex h-6 items-center justify-center rounded border border-line text-xs font-bold text-ink-soft">
                    {ja.facility.unrated}
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <div className="h-6 flex-1 rounded border border-line bg-paper" role="img" aria-label={`${v} / 100`}>
                      <div className="h-full rounded-l bg-accent" style={{ width: `${v}%` }} />
                    </div>
                    <span className="w-8 text-right tabular-nums">{v}</span>
                  </div>
                )}
              </dd>
            </div>
          )
        })}
      </dl>
      <details className="mt-2 rounded border border-line bg-surface p-3 text-sm">
        <summary className="cursor-pointer font-bold">{ja.facility.breakdown}</summary>
        <p className="m-0 mt-2">{ja.facility.methodVersion}：{String(scores.breakdown.method_version ?? '')}</p>
        <pre className="m-0 mt-2 overflow-x-auto whitespace-pre-wrap rounded bg-paper p-2 text-xs">{JSON.stringify(scores.breakdown, null, 2)}</pre>
      </details>
    </section>
  )
}

function Amenities({ facility }: { facility: Facility }) {
  return (
    <section aria-labelledby="amen-h">
      <h2 id="amen-h" className="m-0 text-lg font-bold">{ja.facility.amenities}</h2>
      <p className="m-0 mb-2 text-xs text-ink-soft">{ja.facility.amenitiesNote}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {amenityCategories.map((cat) => (
          <div key={cat.key} className="rounded border border-line bg-surface p-3">
            <h3 className="m-0 mb-1 text-sm font-bold">{cat.label_ja}</h3>
            <dl className="m-0 text-sm">
              {cat.items.map((def) => {
                const v = facility.amenities[def.key]
                const known = v !== undefined && v.confidence !== 'disputed'
                return (
                  <div key={def.key} className="flex justify-between gap-3 border-t border-line py-1 first:border-t-0">
                    <dt>{def.label_ja}</dt>
                    <dd className={known ? 'm-0 font-bold' : 'm-0 text-ink-soft'}>{formatAmenity(def, v)}</dd>
                  </div>
                )
              })}
            </dl>
          </div>
        ))}
      </div>
    </section>
  )
}
