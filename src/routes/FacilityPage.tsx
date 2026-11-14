import { Link, useParams } from '@tanstack/react-router'
import { useState } from 'react'
import { HAZARD_KEYS, type AmenityValue, type Facility } from '../../shared/types.ts'
import { DisputeForm, History } from '../components/Community.tsx'
import { Status } from '../components/Layout.tsx'
import { MapView } from '../components/MapView.tsx'
import { StateLabel } from '../components/StateMark.tsx'
import { ja } from '../i18n/ja.ts'
import { amenityCategories, formatValue } from '../lib/amenities.ts'
import { useFacilityHistory, useLiveAmenities } from '../lib/community.ts'
import { supabase } from '../lib/supabase.ts'
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
    <article className="mx-auto w-full max-w-3xl space-y-7 px-4 py-5">
      <nav aria-label={ja.list.breadcrumb} className="text-base leading-loose [&_a]:inline-block [&_a]:py-1.5">
        <Link to="/list">{ja.list.top}</Link>
        {' › '}
        <Link to="/list/$prefCode" params={{ prefCode: muni.data.pref_code }}>{muni.data.pref_name}</Link>
        {' › '}
        <Link to="/list/$prefCode/$muniKey" params={{ prefCode: muni.data.pref_code, muniKey }}>{muni.data.muni_name}</Link>
      </nav>

      <header>
        <h1 className="m-0 text-2xl font-bold leading-snug">{facility.name}</h1>
        <p className="m-0 mt-1"><StateLabel state={facility.scores.display_state} restrictedOnly={restrictedOnly} /></p>
        <dl className="m-0 mt-2 text-base">
          <dt className="sr-only">{ja.facility.address}</dt>
          <dd className="m-0">{facility.address}</dd>
        </dl>
        <p className="m-0 mt-2 text-base">
          <a href={routeUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded border border-ink px-4 font-bold no-underline">{ja.facility.openRoute}</a>
        </p>
      </header>

      <MapView
        mode="single"
        lat={facility.lat}
        lng={facility.lng}
        state={facility.scores.display_state}
        restrictedOnly={restrictedOnly}
        className="h-64 w-full overflow-hidden rounded border border-line"
        label={ja.facility.mapLabel}
      />

      <Designations facility={facility} />
      <ScoreBars facility={facility} />
      <Amenities facility={facility} muniKey={muniKey} />
      {supabase && <History facilityId={facility.id} />}

      <section aria-labelledby="source-h" className="rounded border border-line bg-surface p-4 text-base">
        <h2 id="source-h" className="m-0 mb-2 text-lg font-bold">{ja.facility.source}</h2>
        <p className="m-0">{ja.facility.sourceText}</p>
        {meta.data && <p className="m-0">{ja.facility.fetchedDate}：{meta.data.d1_fetched_date}</p>}
        <p className="m-0 mt-2 font-bold">{ja.facility.cityNote}</p>
        <p className="m-0 mt-2">{ja.facility.kindNote}</p>
        {facility.merge_rules.length > 0 && <p className="m-0 mt-2 text-ink-soft">{ja.facility.mergeNote}</p>}
        {supabase && (
          <p className="m-0 mt-2">
            <a href={`/removal-request?facility=${encodeURIComponent(facility.id)}`}>{ja.community.removal.link}</a>
          </p>
        )}
      </section>
    </article>
  )
}

function Designations({ facility }: { facility: Facility }) {
  const { emergency_site, shelter } = facility.designations
  return (
    <section aria-labelledby="desig-h">
      <h2 id="desig-h" className="m-0 mb-2 text-xl font-bold">{ja.facility.designations}</h2>
      <div className="space-y-3">
        <div className="rounded border border-line bg-surface p-4">
          <h3 className="m-0 text-lg font-bold">{ja.kind.emergency}</h3>
          <p className="m-0 text-sm text-ink-soft">{ja.kind.emergencyHelp}</p>
          {emergency_site.length === 0 && <p className="m-0 mt-2 text-base">{ja.kind.none}</p>}
          {emergency_site.map((d) => (
            <div key={d.source_id} className="mt-3 border-t border-line pt-3 first-of-type:border-t-0">
              <p className="m-0 text-base font-bold">{d.name}</p>
              <ul className="m-0 mt-1.5 flex list-none flex-wrap gap-1.5 p-0 text-sm">
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
          <h3 className="m-0 text-lg font-bold">{ja.kind.shelter}</h3>
          <p className="m-0 text-sm text-ink-soft">{ja.kind.shelterHelp}</p>
          {shelter.length === 0 && <p className="m-0 mt-2 text-base">{ja.kind.none}</p>}
          {shelter.map((d) => (
            <div key={d.source_id} className="mt-3 border-t border-line pt-3 first-of-type:border-t-0">
              <p className="m-0 text-base font-bold">{d.name}</p>
              {d.restricted && (
                <p className="m-0 mt-1.5 rounded border-2 border-ink p-2 text-base">
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
  return <p className="m-0 mt-1.5 text-base"><span className="text-ink-soft">{label}：</span>{value}</p>
}
function SourceId({ id }: { id: string }) {
  return <p className="m-0 mt-1 text-sm text-ink-soft">{ja.kind.sourceIdLabel}：{id}</p>
}

function ScoreBars({ facility }: { facility: Facility }) {
  const { scores } = facility
  return (
    <section aria-labelledby="scores-h">
      <h2 id="scores-h" className="m-0 text-xl font-bold">{ja.facility.scores}</h2>
      <p className="m-0 mb-2 text-sm text-ink-soft">{ja.facility.scoresNote}</p>
      <dl className="m-0 space-y-2 rounded border border-line bg-surface p-4">
        {AXES.map((axis) => {
          const v = scores[axis]
          return (
            <div key={axis} className="grid grid-cols-1 items-center gap-1 text-base sm:grid-cols-[10rem_1fr] sm:gap-3">
              <dt>{ja.facility.axes[axis]}</dt>
              <dd className="m-0">
                {v === null ? (
                  // 未評価は 0 点に見せない：空のバーではなく、斜線の帯と文字で示す
                  <div className="axis-unrated flex h-8 items-center justify-center rounded border border-line text-sm font-bold text-ink-soft">
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
      <details className="mt-2 rounded border border-line bg-surface p-3 text-base">
        <summary className="cursor-pointer font-bold">{ja.facility.breakdown}</summary>
        <p className="m-0 mt-2">{ja.facility.methodVersion}：{String(scores.breakdown.method_version ?? '')}</p>
        <pre className="m-0 mt-2 overflow-x-auto whitespace-pre-wrap rounded bg-paper p-2 text-sm">{JSON.stringify(scores.breakdown, null, 2)}</pre>
      </details>
    </section>
  )
}

function Amenities({ facility, muniKey }: { facility: Facility; muniKey: string }) {
  // 静的 JSON の確定値に、Supabase の最新の確定値を上書きする。取得に失敗しても静的値で表示を続ける（SPEC §4.3）
  const live = useLiveAmenities(facility.id)
  const history = useFacilityHistory(facility.id)
  const amenities: Record<string, AmenityValue> = { ...facility.amenities, ...(live.data ?? {}) }
  const [disputing, setDisputing] = useState<string | null>(null)
  const openDisputes = (history.data?.disputes ?? []).filter((d) => d.status === 'open')
  return (
    <section aria-labelledby="amen-h">
      <h2 id="amen-h" className="m-0 text-xl font-bold">{ja.facility.amenities}</h2>
      <p className="m-0 mb-2 text-sm text-ink-soft">{ja.facility.amenitiesNote}</p>
      {supabase && (
        <p className="m-0 mb-3 rounded border border-line bg-surface p-3 text-base">
          <Link to="/f/$muniKey/$facilityId/report" params={{ muniKey, facilityId: facility.id }} className="inline-flex min-h-12 items-center rounded bg-ink px-5 text-lg font-bold text-white no-underline">
            {ja.community.addInfo}
          </Link>
          <span className="mt-1 block text-sm text-ink-soft">{ja.community.mapDelay}</span>
        </p>
      )}
      {live.isError && <p role="status" className="m-0 mb-2 text-sm text-ink-soft">{ja.community.liveError}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {amenityCategories.map((cat) => (
          <div key={cat.key} className="rounded border border-line bg-surface p-3">
            <h3 className="m-0 mb-1 text-base font-bold">{cat.label_ja}</h3>
            <dl className="m-0 text-base">
              {cat.items.map((def) => {
                const v = amenities[def.key]
                const disputed = v?.confidence === 'disputed'
                const counters = openDisputes.filter((d) => d.amenity_key === def.key)
                return (
                  <div key={def.key} className="border-t border-line py-1.5 first:border-t-0">
                    <div className="flex justify-between gap-3">
                      <dt>{def.label_ja}</dt>
                      <dd className={v && !disputed ? 'm-0 text-right font-bold' : 'm-0 text-right text-ink-soft'}>
                        {v ? formatValue(def, v.value) : ja.facility.unknownValue}
                      </dd>
                    </div>
                    {v && (
                      <div className="mt-0.5 flex flex-wrap items-center justify-end gap-x-2 text-sm text-ink-soft">
                        <span
                          className={disputed ? 'rounded border border-ink px-1.5 font-bold text-ink' : 'rounded border border-line px-1.5'}
                          title={ja.community.confidenceHelp[v.confidence]}
                        >
                          {ja.community.confidence[v.confidence]}
                        </span>
                        <span>{ja.community.evidence(v.evidence_count)}</span>
                        {v.observed_at && <span>{ja.community.observedAt} {v.observed_at}</span>}
                        {supabase && (
                          <button type="button" className="min-h-0 py-1 underline" aria-expanded={disputing === def.key}
                            onClick={() => setDisputing(disputing === def.key ? null : def.key)}>
                            {ja.community.dispute.button}
                          </button>
                        )}
                      </div>
                    )}
                    {/* 争点は議論ではなく「対立する2つの値」として並べる（SPEC §4.4） */}
                    {v && disputed && (
                      <div className="mt-1 grid grid-cols-2 gap-2 text-sm">
                        <div className="rounded border border-line p-1.5">
                          <div className="text-ink-soft">{ja.community.dispute.currentValue}</div>
                          <div className="font-bold">{formatValue(def, v.value)}</div>
                        </div>
                        <div className="rounded border border-line p-1.5">
                          <div className="text-ink-soft">{ja.community.dispute.counterValue}</div>
                          <div className="font-bold">
                            {counters.filter((c) => c.counter_value !== null).map((c) => formatValue(def, c.counter_value)).join('、')
                              || ja.community.dispute.noCounter}
                          </div>
                        </div>
                      </div>
                    )}
                    {disputing === def.key && <DisputeForm facilityId={facility.id} def={def} onClose={() => setDisputing(null)} />}
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
