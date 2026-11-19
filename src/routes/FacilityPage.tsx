import { Link, useParams } from '@tanstack/react-router'
import { useState } from 'react'
import { expandBreakdown } from '../../shared/score.ts'
import { HAZARD_KEYS, type AmenityValue, type Facility } from '../../shared/types.ts'
import { DisputeForm, History } from '../components/Community.tsx'
import { Status } from '../components/Layout.tsx'
import { HazardOverlayPicker } from '../components/HazardOverlayPicker.tsx'
import { MapView } from '../components/MapView.tsx'
import type { HazardOverlay } from '../lib/map/index.ts'
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
  const [overlay, setOverlay] = useState<HazardOverlay | null>(null)
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
        hazardOverlay={overlay}
      />
      <HazardOverlayPicker value={overlay} onChange={setOverlay} />
      <PointDepthSection depth={facility.depth} />

      <Designations facility={facility} />
      <ScoreBars facility={facility} texts={muni.data?.breakdown_texts} />
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
                      d.hazards[k] && d.zone?.[k] === 'in'
                        ? 'rounded border-2 border-state-critical bg-white px-1.5 py-0.5 font-bold text-state-critical'
                        : d.hazards[k]
                          ? 'rounded border border-ink bg-ink px-1.5 py-0.5 text-white'
                          : 'rounded border border-dashed border-line px-1.5 py-0.5 text-ink-soft'
                    }
                  >
                    {ja.hazard.names[k]}
                    <span className="sr-only">：{d.hazards[k] ? ja.hazard.designated : ja.hazard.notDesignated}</span>
                    <span aria-hidden="true">{d.hazards[k] ? ' ✓' : ' −'}</span>
                    {d.hazards[k] && d.zone?.[k] === 'in' && <span className="ml-2">{ja.hazard.inZone}</span>}
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

function ScoreBars({ facility, texts }: { facility: Facility; texts: unknown[] | undefined }) {
  const { scores } = facility
  // 保存時に表へ移した文章（式・注記・出典）を戻して、根拠の全文を表示する
  const breakdown = expandBreakdown(scores.breakdown, texts, facility.road)
  return (
    <section aria-labelledby="scores-h">
      <h2 id="scores-h" className="m-0 text-xl font-bold">{ja.facility.scores}</h2>
      <p className="m-0 mb-2 text-sm text-ink-soft">{ja.facility.scoresNote}</p>
      <dl className="m-0 space-y-2 rounded border border-line bg-surface p-4">
        {AXES.map((axis) => {
          const v = scores[axis]
          // 軸A は点数を出さず、想定区域との重なりの有無を文で示す（SPEC §3.2）
          if (axis === 'hazard') return <HazardAxis key={axis} check={scores.hazard_check} sites={facility.designations.emergency_site} />
          // 軸B も点数を出さない。公表されている収容人数だけを示す（DATA_NOTES D-22）
          if (axis === 'capacity') return <CapacityAxis key={axis} facility={facility} capacity={breakdown.capacity} />
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
                {axis === 'logistics' && v !== null && facility.road && <RoadDetail facility={facility} logistics={breakdown.logistics} />}
                {axis === 'logistics' && v === null && facility.road && (
                  <p className="m-0 mt-1 text-sm text-ink-soft">{facility.road.land === 'no_road' ? ja.facility.road.noRoadOnLand : ja.facility.road.notFound(facility.road.searched_m)} {ja.facility.road.source}</p>
                )}
              </dd>
            </div>
          )
        })}
      </dl>
      <details className="mt-2 rounded border border-line bg-surface p-3 text-base">
        <summary className="cursor-pointer font-bold">{ja.facility.breakdown}</summary>
        <p className="m-0 mt-2">{ja.facility.methodVersion}：{String(breakdown.method_version ?? '')}</p>
        <pre className="m-0 mt-2 overflow-x-auto whitespace-pre-wrap rounded bg-paper p-2 text-sm">{JSON.stringify(breakdown, null, 2)}</pre>
      </details>
    </section>
  )
}

function CapacityAxis({ facility, capacity }: { facility: Facility; capacity: unknown }) {
  const t = ja.facility
  // 表に移した内容を戻したあとの根拠を使う（保存時は軸ごと参照になっていることがある）
  const ref = capacity as { capacity_persons?: number | null; per_person_sqm?: number | null; toilet_total?: number | null; toilets_sphere_reference?: number | null } | undefined
  const persons = ref?.capacity_persons ?? null
  const perPerson = ref?.per_person_sqm ?? null
  // 自治体の公表値は指定ごとに持つ。何の人数か（緊急避難場所／指定避難所）を添えて出す（DATA_NOTES D-28）
  const published = [
    ...facility.designations.emergency_site.filter((d) => d.capacity).map((d) => ({ d, kind: ja.kind.emergency })),
    ...facility.designations.shelter.filter((d) => d.capacity).map((d) => ({ d, kind: ja.kind.shelter })),
  ]
  const src = published[0]?.d.capacity!.source
  return (
    <div className="grid grid-cols-1 items-start gap-1 text-base sm:grid-cols-[10rem_1fr] sm:gap-3">
      <dt>{t.axes.capacity}</dt>
      <dd className="m-0 rounded border border-line p-2">
        <p className="m-0 font-bold">{t.capacityNotScored}</p>
        {published.length > 0 && (
          <div className="mt-1 text-sm">
            <p className="m-0 text-ink-soft">{t.capacityPublishedLabel}</p>
            <ul className="m-0 list-none p-0">
              {published.map(({ d, kind }) => (
                <li key={d.source_id} className="mt-0.5">
                  {t.capacityPublished(d.name, d.capacity!.persons, kind)}
                  {d.capacity!.raw.normalize('NFKC').replace(/[,人名\s]/g, '') !== String(d.capacity!.persons) && (
                    <span className="block text-ink-soft">{t.capacityRaw(d.capacity!.raw)}</span>
                  )}
                  {d.capacity!.listed_name && d.capacity!.listed_name.normalize('NFKC').replace(/\s+/g, '') !== d.name.normalize('NFKC').replace(/\s+/g, '') && (
                    <span className="block text-ink-soft">{t.capacityListedName(d.capacity!.listed_name)}</span>
                  )}
                </li>
              ))}
            </ul>
            <p className="m-0 mt-1 text-ink-soft">{t.capacityPublishedNote}</p>
            <p className="m-0 mt-1 text-ink-soft">
              {t.capacitySource(src!)}{' '}
              <a href={src!.page_url} target="_blank" rel="noreferrer">{src!.publisher}</a>
            </p>
          </div>
        )}
        <p className="m-0 mt-1 text-sm">
          {published.length > 0 && <span className="mr-2 text-ink-soft">{t.capacityPostedLabel}</span>}
          {persons === null ? t.capacityUnknown : t.capacityPersons(persons)}
        </p>
        {perPerson !== null && <p className="m-0 mt-1 text-sm">{t.capacityPerPerson(perPerson)}</p>}
        {ref?.toilet_total != null && ref.toilets_sphere_reference != null && (
          <p className="m-0 mt-1 text-sm">{t.capacityToilets(ref.toilet_total, ref.toilets_sphere_reference)}</p>
        )}
        <p className="m-0 mt-1 text-sm text-ink-soft">{t.capacityNote}</p>
      </dd>
    </div>
  )
}

function RoadDetail({ facility, logistics }: { facility: Facility; logistics: unknown }) {
  const t = ja.facility.road
  const road = facility.road!
  // 備蓄の扱いは、点数の算出に使った値（算出根拠）をそのまま示す。設備項目を画面で直接読まない（CLAUDE.md 絶対ルール 4）
  const stock = (logistics as { stockpile_onsite?: unknown } | undefined)?.stockpile_onsite
  const known = typeof stock === 'boolean' ? stock : null
  return (
    <div className="mt-1 text-sm">
      <p className="m-0">
        {road.distance_m === null ? t.notFound(road.searched_m) : t.distance(road.distance_m)}
        {road.name && <span>（{road.name}{road.class !== null && t.classes[road.class] ? `・${t.classes[road.class]}` : ''}）</span>}
      </p>
      <p className="m-0 mt-1">{known === null ? t.stockpile.unknown : known ? t.stockpile.yes : t.stockpile.no}</p>
      <p className="m-0 mt-1 text-ink-soft">
        {t.note}{road.source_ym ? ` ${t.sourceYm(road.source_ym)}。` : ''} {t.source}
      </p>
    </div>
  )
}

function HazardAxis({ check, sites }: { check: Facility['scores']['hazard_check'] | undefined; sites: Facility['designations']['emergency_site'] }) {
  const t = ja.hazard.check
  // 想定区域と重なった指定に付いている備考。判定には使わず、原文のまま並べる（DATA_NOTES D-19）
  const notes = [...new Set(sites.filter((d) => d.note && Object.values(d.zone ?? {}).includes('in')).map((d) => d.note!))]
  const status = check?.status ?? 'not_evaluated'
  const names = (keys: readonly (keyof typeof ja.hazard.names)[]) => keys.map((k) => ja.hazard.names[k]).join('、')
  return (
    <div className="grid grid-cols-1 items-start gap-1 text-base sm:grid-cols-[10rem_1fr] sm:gap-3">
      <dt>{ja.facility.axes.hazard}</dt>
      <dd className="m-0">
        {status === 'not_evaluated' ? (
          <div className="axis-unrated flex h-8 items-center justify-center rounded border border-line text-sm font-bold text-ink-soft">
            {t.not_evaluated}
          </div>
        ) : (
          <div className={status === 'attention' ? 'rounded border-2 border-state-critical p-2' : 'rounded border border-line p-2'}>
            <p className="m-0 font-bold">
              <span aria-hidden="true">{status === 'attention' ? '! ' : ''}</span>
              {t[status]}
            </p>
            {check && check.overlap.length > 0 && (
              <p className="m-0 mt-1 text-sm">{t.overlapLabel}：<strong>{names(check.overlap)}</strong></p>
            )}
            {notes.length > 0 && (
              <div className="mt-1 rounded bg-paper p-2 text-sm">
                <p className="m-0 text-ink-soft">{t.muniNoteLabel}</p>
                {notes.map((n) => <p key={n} className="m-0 mt-1 whitespace-pre-wrap">{n}</p>)}
              </div>
            )}
            <p className="m-0 mt-1 text-sm text-ink-soft">{status === 'attention' ? t.attentionNote : t.noOverlapNote}</p>
            {check && (
              <p className="m-0 mt-1 text-sm text-ink-soft">
                {t.checkedLabel}：{names(check.checked) || '—'}
                {check.unchecked.length > 0 && <span className="ml-3">{t.uncheckedLabel}：{names(check.unchecked)}</span>}
              </p>
            )}
            <p className="m-0 mt-1 text-sm text-ink-soft">{t.cityNote} {t.source}</p>
          </div>
        )}
      </dd>
    </div>
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

/** 施設の地点の想定浸水深・土砂災害の区域（DATA_NOTES 14.5）。分からない種別は「データなし・未確認」 */
function PointDepthSection({ depth }: { depth: Facility['depth'] }) {
  const t = ja.colorBy
  const rows: [string, string][] = [
    [t.names.flood, depth?.flood !== undefined ? t.depthClasses[depth.flood]! : t.unknown],
    [t.names.tsunami, depth?.tsunami !== undefined ? t.depthClasses[depth.tsunami]! : t.unknown],
    [t.names.storm_surge, depth?.storm_surge !== undefined ? t.depthClasses[depth.storm_surge]! : t.unknown],
    [t.names.landslide, depth?.landslide !== undefined ? t.landslideClasses[depth.landslide]! : t.unknown],
  ]
  return (
    <section aria-labelledby="depth-h" className="rounded border border-line bg-surface p-4 text-base">
      <h2 id="depth-h" className="m-0 mb-2 text-lg font-bold">{ja.facility.depthTitle}</h2>
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-ink-soft">{k}</dt>
            <dd className="m-0 font-bold">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="m-0 mt-2 text-sm text-ink-soft">{t.depthNote}</p>
      <p className="m-0 mt-1 text-sm text-ink-soft">{ja.facility.depthSource}</p>
    </section>
  )
}
