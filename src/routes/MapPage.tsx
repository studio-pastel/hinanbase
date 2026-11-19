import { Link } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { DISPLAY_STATES, HAZARD_KEYS, KIND_EMERGENCY, KIND_SHELTER, type DisplayState, type HazardKey } from '../../shared/types.ts'
import { HazardOverlayPicker } from '../components/HazardOverlayPicker.tsx'
import { MapView } from '../components/MapView.tsx'
import { AttentionMark, StateLabel, StateMark } from '../components/StateMark.tsx'
import type { GeocodeHit } from '../../shared/geocode.ts'
import type { PrefIndexEntry } from '../../shared/types.ts'
import { fmt, ja, pct } from '../i18n/ja.ts'
import { searchAddress, type SearchOutcome } from '../lib/addressSearch.ts'
import { DATA_BASE_URL, useMuniIndex, useNational } from '../lib/data.ts'
import { loadMapView, saveMapView } from '../lib/places.ts'
import { COLOR_BYS, METRIC_SCALES, METRIC_UNKNOWN_COLOR, isClusterCountUnavailable, type ColorBy, type HazardOverlay, type MapFeature, type MapFilter } from '../lib/map/index.ts'

const tilesUrl = `${DATA_BASE_URL || window.location.origin}/tiles/shelters.pmtiles`
const pointsUrl = `${DATA_BASE_URL || window.location.origin}/tiles/points.pmtiles`

export function MapPage() {
  const national = useNational()
  const [filter, setFilter] = useState<MapFilter>({ kind: 'all', hazard: 'all', states: [...DISPLAY_STATES], ac: 'all', overlap: 'all' })
  const [selected, setSelected] = useState<MapFeature | null>(null)
  const [overlay, setOverlay] = useState<HazardOverlay | null>(null)
  // 設備の情報はほぼ公表されていないため、最初は分かっている指標（洪水の浸水深）で色分けする（DATA_NOTES 14.5）
  const [colorBy, setColorBy] = useState<ColorBy>('flood')
  // スマホでは絞り込みを閉じた状態から始め、地図を広く見せる
  const [panelOpen, setPanelOpen] = useState(() => window.matchMedia('(min-width: 768px)').matches)
  // 前回見ていた場所（なければ保存した場所）から表示する。どちらもなければ全国
  const [initialView] = useState(() => loadMapView())
  const [target, setTarget] = useState<{ lat: number; lng: number; zoom: number } | null>(null)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <section aria-label={ja.summary.label} className="flex flex-wrap items-baseline gap-x-6 gap-y-0 border-b border-line bg-surface px-3 py-1 text-sm leading-snug sm:px-4 sm:py-1.5 sm:text-base">
        {national.data ? (
          <>
            <p className="m-0">
              {ja.summary.facilities}{' '}
              <strong className="tabular-nums sm:text-lg">{fmt.format(national.data.facility_count)}</strong> {ja.unitFacilities}
            </p>
            <p className="m-0">
              {ja.summary.withAmenity}{' '}
              <strong className="tabular-nums sm:text-lg">
                {fmt.format(national.data.amenity_coverage.facilities_with_any)}
              </strong>{' '}
              {ja.unitFacilities}（{pct(national.data.amenity_coverage.ratio)}）
            </p>
            <p className="m-0 hidden text-sm text-ink-soft sm:block">{ja.summary.withAmenityNote}</p>
          </>
        ) : (
          <p className="m-0 text-ink-soft" role={national.isError ? 'alert' : 'status'}>
            {national.isError ? ja.loadError : ja.loading}
          </p>
        )}
      </section>

      {/* スマホでは地図を画面の高さいっぱいに取る（下にスクロールすると出典などが続く） */}
      <div className="relative h-[calc(100dvh-15.5rem)] min-h-[360px] md:h-auto md:min-h-0 md:flex-1">
        <MapView
          mode="national"
          tilesUrl={tilesUrl}
          pointsUrl={pointsUrl}
          colorBy={colorBy}
          view={initialView ?? undefined}
          target={target}
          className="absolute inset-0"
          label={ja.map.label}
          filter={filter}
          selectedId={selected?.id ?? null}
          onSelect={setSelected}
          hazardOverlay={overlay}
          onViewChange={(lat, lng, zoom) => { if (zoom >= 8) saveMapView({ lat, lng, zoom }) }}
        />

        {/* 上：検索窓。スマホでは右に「絞り込み」ボタンを並べる */}
        <div className="absolute left-2 right-14 top-2 z-20 md:left-[22rem] md:right-auto md:w-[26rem]">
          <SearchBox
            onGo={(lat, lng, zoom) => { setSelected(null); setTarget({ lat, lng, zoom }) }}
            panelOpen={panelOpen}
            onTogglePanel={() => setPanelOpen((v) => !v)}
          />
          <label className="mt-1 flex w-fit max-w-full items-center gap-1 rounded border border-line bg-surface py-0.5 pl-2 pr-1 text-sm shadow">
            <span className="shrink-0 font-bold">{ja.colorBy.label}</span>
            <select value={colorBy} onChange={(e) => setColorBy(e.target.value as ColorBy)} className="min-h-9 min-w-0 rounded border-0 bg-white px-1 text-sm">
              {COLOR_BYS.map((c) => <option key={c} value={c}>{ja.colorBy.names[c]}</option>)}
            </select>
          </label>
          {selected && <SelectedCard feature={selected} onClose={() => setSelected(null)} />}
        </div>

        {/* 絞り込み・凡例・ハザード：PC は地図の左に重ねる。スマホは検索窓の下に開く */}
        <div
          id="filter-panel"
          hidden={!panelOpen}
          className="absolute inset-x-2 top-16 z-30 max-h-[calc(100%-5.5rem)] overflow-y-auto rounded border border-line bg-surface shadow-lg md:inset-x-auto md:left-3 md:top-3 md:max-h-[calc(100%-1.5rem)] md:w-80"
        >
          <div className="flex items-center justify-between px-4 pt-2">
            <h2 className="m-0 text-base font-bold">{ja.map.filters}・{ja.state.legend}</h2>
            <button type="button" onClick={() => setPanelOpen(false)} aria-label={ja.search.close} className="min-h-11 rounded px-3 text-xl leading-none hover:bg-paper">×</button>
          </div>
          <div className="space-y-2 px-4 pb-2">
            <ToggleButton on={filter.ac === 'none'} onClick={() => setFilter({ ...filter, ac: filter.ac === 'none' ? 'all' : 'none' })}>
              {filter.ac === 'none' ? ja.map.acNoneOn : ja.map.acNone}
            </ToggleButton>
            {filter.ac === 'none' && <p className="m-0 text-sm text-ink-soft">{ja.map.acNoneHelp}</p>}
            {/* 表示状態は設備の回答が集まるまでグレーのままなので、想定区域との重なりは別の絞り込みで探せるようにする（DATA_NOTES 12.3） */}
            <ToggleButton on={filter.overlap === 'only'} onClick={() => setFilter({ ...filter, overlap: filter.overlap === 'only' ? 'all' : 'only' })}>
              {filter.overlap === 'only' ? ja.map.overlapOnlyOn : ja.map.overlapOnly}
            </ToggleButton>
            {filter.overlap === 'only' && <p className="m-0 text-sm text-ink-soft">{ja.map.overlapOnlyHelp}</p>}
            <div className="pt-1 text-base">
              <HazardOverlayPicker value={overlay} onChange={setOverlay} />
            </div>
          </div>
          <div className="space-y-4 px-4 pb-4 text-base">
            <FilterControls filter={filter} onChange={setFilter} />
            {colorBy === 'state' ? <Legend /> : <MetricLegend colorBy={colorBy} />}
            <p className="m-0">
              <Link to="/list">{ja.map.listAlternative}</Link>
            </p>
          </div>
          {isClusterCountUnavailable(filter) && (
            <p role="status" className="m-0 mx-4 mb-2 rounded bg-paper p-2 text-sm">{ja.map.clusterCountUnavailable}</p>
          )}
        </div>

        {/* 凡例は常時表示（SPEC §3.6）。パネルを閉じているときは地図の左下に小さく出す */}
        {!panelOpen && (
          <div className="pointer-events-none absolute bottom-9 left-2 z-10 flex max-w-[calc(100%-1rem)] flex-wrap gap-x-2 gap-y-0.5 rounded bg-surface/90 px-2 py-1 text-xs shadow md:bottom-10 md:text-sm">
            {colorBy === 'state' ? (
              <>
                {DISPLAY_STATES.map((s) => <StateLabel key={s} state={s} />)}
                <span className="flex items-center gap-1"><AttentionMark />{ja.state.attentionShort}</span>
              </>
            ) : <MetricLegendItems colorBy={colorBy} />}
          </div>
        )}
      </div>
    </div>
  )
}

function ToggleButton({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={
        on
          ? 'w-full rounded border-2 border-ink bg-ink px-3 py-2 text-base font-bold text-white'
          : 'w-full rounded border-2 border-ink bg-white px-3 py-2 text-base font-bold'
      }
    >
      {children}
    </button>
  )
}

/** 住所・地名で探す。照合は端末の中だけで行う（D-33） */
function SearchBox({ onGo, panelOpen, onTogglePanel }: { onGo: (lat: number, lng: number, zoom: number) => void; panelOpen: boolean; onTogglePanel: () => void }) {
  const t = ja.search
  const index = useMuniIndex()
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<SearchOutcome | null>(null)
  const [error, setError] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const go = (h: GeocodeHit) => onGo(h.lat, h.lng, h.level === 'town' ? 14 : 12)

  async function run(pref?: PrefIndexEntry) {
    if (!q.trim() || !index.data) return
    setBusy(true); setError(false)
    try {
      const r = await searchAddress(q, index.data, pref)
      setOutcome(r)
      if (r.status === 'found' || r.status === 'muni_only') {
        go(r.hit)
        inputRef.current?.blur()
      }
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <form role="search" aria-label={t.label} onSubmit={(e) => { e.preventDefault(); void run() }} className="flex gap-1 rounded border border-line bg-surface p-1 shadow-lg">
        <input
          ref={inputRef}
          type="search"
          value={q}
          onChange={(e) => { setQ(e.target.value); setOutcome(null) }}
          placeholder={t.placeholder}
          aria-label={t.label}
          enterKeyHint="search"
          autoComplete="off"
          className="min-h-11 min-w-0 flex-1 rounded border-0 bg-white px-2 text-base"
        />
        <button type="submit" disabled={busy || !index.data} className="min-h-11 shrink-0 rounded bg-ink px-3 text-base font-bold text-white">
          {busy ? '…' : t.submit}
        </button>
        <button
          type="button"
          onClick={onTogglePanel}
          aria-expanded={panelOpen}
          aria-controls="filter-panel"
          className={panelOpen ? 'min-h-11 shrink-0 rounded border-2 border-ink bg-ink px-2 text-sm font-bold text-white' : 'min-h-11 shrink-0 rounded border-2 border-ink bg-white px-2 text-sm font-bold'}
        >
          {t.filters}
        </button>
      </form>
      {(outcome && outcome.status !== 'found') || error ? (
        <div role="status" className="mt-1 rounded border border-line bg-surface p-2 text-sm shadow-lg">
          {error && <p className="m-0">{ja.loadError}</p>}
          {outcome?.status === 'not_found' && <p className="m-0">{t.notFound}</p>}
          {outcome?.status === 'muni_only' && <p className="m-0">{t.muniOnly(outcome.hit.muni.name)}</p>}
          {outcome?.status === 'choose_pref' && (
            <>
              <p className="m-0 font-bold">{t.choosePref}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {outcome.prefs.map((p) => (
                  <button key={p.code} type="button" onClick={() => void run(p)} className="min-h-9 rounded border border-ink bg-white px-3">{p.name}</button>
                ))}
              </div>
            </>
          )}
          {outcome?.status === 'choose_town' && (
            <>
              <p className="m-0 font-bold">{t.chooseTown}</p>
              <div className="mt-1 flex max-h-40 flex-wrap gap-1 overflow-y-auto">
                {outcome.candidates.map((c) => (
                  <button key={c.town} type="button" onClick={() => { go(c); setOutcome(null) }} className="min-h-9 rounded border border-ink bg-white px-3">{c.town}</button>
                ))}
              </div>
            </>
          )}
          <button type="button" onClick={() => { setOutcome(null); setError(false) }} className="mt-1 min-h-9 text-ink-soft underline">{t.close}</button>
        </div>
      ) : null}
    </div>
  )
}

function FilterControls({ filter, onChange }: { filter: MapFilter; onChange: (f: MapFilter) => void }) {
  const toggleState = (s: DisplayState) =>
    onChange({ ...filter, states: filter.states.includes(s) ? filter.states.filter((x) => x !== s) : [...filter.states, s] })
  return (
    <form className="space-y-3" onSubmit={(e) => e.preventDefault()}>
      <label className="block">
        <span className="mb-1 block font-bold">{ja.kind.label}</span>
        <select
          className="w-full rounded border border-line bg-white px-2 py-1.5"
          value={filter.kind}
          onChange={(e) => onChange({ ...filter, kind: e.target.value as MapFilter['kind'] })}
        >
          <option value="all">{ja.kind.all}</option>
          <option value="emergency">{ja.kind.emergency}</option>
          <option value="shelter">{ja.kind.shelter}</option>
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block font-bold">{ja.hazard.label}</span>
        <select
          className="w-full rounded border border-line bg-white px-2 py-1.5"
          value={filter.hazard}
          aria-describedby="hazard-help"
          onChange={(e) => onChange({ ...filter, hazard: e.target.value as HazardKey | 'all' })}
        >
          <option value="all">{ja.hazard.all}</option>
          {HAZARD_KEYS.map((k) => <option key={k} value={k}>{ja.hazard.names[k]}</option>)}
        </select>
        <span id="hazard-help" className="mt-1 block text-sm text-ink-soft">{ja.hazard.help}</span>
      </label>
      <fieldset className="m-0 border-0 p-0">
        <legend className="mb-1 font-bold">{ja.state.label}</legend>
        <div className="grid grid-cols-1 gap-x-2 gap-y-2 min-[420px]:grid-cols-2 md:grid-cols-1">
          {DISPLAY_STATES.map((s) => (
            <label key={s} className="flex min-h-9 items-center gap-2">
              <input type="checkbox" checked={filter.states.includes(s)} onChange={() => toggleState(s)} />
              <StateLabel state={s} />
            </label>
          ))}
        </div>
      </fieldset>
    </form>
  )
}

function Legend() {
  return (
    <section aria-label={ja.state.legend} className="border-t border-line pt-3">
      <h2 className="m-0 mb-1 text-base font-bold">{ja.state.legend}</h2>
      <ul className="m-0 list-none space-y-1 p-0 text-sm">
        {DISPLAY_STATES.map((s) => (
          <li key={s} className="flex gap-2">
            <StateMark state={s} />
            <span><strong>{ja.state.names[s]}</strong>：{ja.state.descriptions[s]}</span>
          </li>
        ))}
        <li className="flex gap-2"><StateMark state="unknown" restrictedOnly /><span>{ja.state.restrictedLegend}</span></li>
        <li className="flex gap-2"><AttentionMark /><span>{ja.state.attentionLegend}</span></li>
        <li>{ja.state.clusterLegend}</li>
      </ul>
      <p className="m-0 mt-2 text-sm text-ink-soft">{ja.state.phase1Note}</p>
    </section>
  )
}

function SelectedCard({ feature, onClose }: { feature: MapFeature; onClose: () => void }) {
  return (
    <section
      aria-live="polite"
      className="mt-1 rounded border border-line bg-surface p-3 shadow-lg"
    >
      <div className="flex items-start gap-2">
        <h2 className="m-0 flex-1 text-lg font-bold leading-snug">{feature.name}</h2>
        <button type="button" onClick={onClose} aria-label={ja.map.selectedClose} className="rounded px-2 text-xl leading-none hover:bg-paper">×</button>
      </div>
      <ul className="m-0 mt-1 flex list-none flex-wrap gap-1.5 p-0 text-sm">
        {feature.kind & KIND_EMERGENCY ? <li className="rounded border border-line px-1.5 py-0.5">{ja.kind.emergency}</li> : null}
        {feature.kind & KIND_SHELTER ? <li className="rounded border border-line px-1.5 py-0.5">{ja.kind.shelter}</li> : null}
        {feature.restrictedOnly && <li className="rounded border border-ink px-1.5 py-0.5 font-bold">{ja.kind.restrictedShort}</li>}
      </ul>
      <p className="m-0 mt-2 text-base"><StateLabel state={feature.state} restrictedOnly={feature.restrictedOnly} /></p>
      <p className="m-0 mt-2 text-base">
        <Link to="/f/$muniKey/$facilityId" params={{ muniKey: feature.muni, facilityId: feature.id }} className="inline-flex min-h-11 items-center rounded bg-ink px-4 font-bold text-white no-underline">
          {ja.map.openDetail}
        </Link>
      </p>
    </section>
  )
}

function metricLabels(colorBy: Exclude<ColorBy, 'state'>): readonly string[] {
  const t = ja.colorBy
  return colorBy === 'road' ? t.roadClasses : colorBy === 'landslide' ? t.landslideClasses : t.depthClasses
}

function MetricDot({ color }: { color: string }) {
  return <span aria-hidden="true" className="inline-block h-3 w-3 shrink-0 rounded-full border border-[#333]" style={{ background: color }} />
}

function MetricLegendItems({ colorBy }: { colorBy: Exclude<ColorBy, 'state'> }) {
  const labels = metricLabels(colorBy)
  return (
    <>
      {METRIC_SCALES[colorBy].colors.map((c, i) => (
        <span key={c + i} className="flex items-center gap-1"><MetricDot color={c} />{labels[i]}</span>
      ))}
      <span className="flex items-center gap-1"><MetricDot color={METRIC_UNKNOWN_COLOR} />{ja.colorBy.unknown}</span>
    </>
  )
}

function MetricLegend({ colorBy }: { colorBy: Exclude<ColorBy, 'state'> }) {
  const t = ja.colorBy
  const note = colorBy === 'road' ? t.roadNote : colorBy === 'landslide' ? t.landslideNote : t.depthNote
  return (
    <section aria-label={ja.state.legend} className="border-t border-line pt-3">
      <h2 className="m-0 mb-1 text-base font-bold">{ja.state.legend}：{t.names[colorBy]}</h2>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm"><MetricLegendItems colorBy={colorBy} /></div>
      <p className="m-0 mt-2 text-sm text-ink-soft">{note}</p>
      <p className="m-0 mt-1 text-sm text-ink-soft">{t.stateNote}</p>
    </section>
  )
}
