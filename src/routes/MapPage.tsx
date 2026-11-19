import { Link } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { DISPLAY_STATES, HAZARD_KEYS, KIND_EMERGENCY, KIND_SHELTER, type DisplayState, type HazardKey } from '../../shared/types.ts'
import { HazardOverlayPicker } from '../components/HazardOverlayPicker.tsx'
import { MapView } from '../components/MapView.tsx'
import { AttentionMark, StateLabel, StateMark } from '../components/StateMark.tsx'
import type { GeocodeHit } from '../../shared/geocode.ts'
import { fmt, ja, pct } from '../i18n/ja.ts'
import { loadGeocode, resolvePrefs, searchAddress, suggestMunis, suggestTowns, type Suggestion } from '../lib/addressSearch.ts'
import { DATA_BASE_URL, useMuniIndex, useNational } from '../lib/data.ts'
import { loadMapView, saveMapView } from '../lib/places.ts'
import { COLOR_BYS, METRIC_SCALES, METRIC_UNKNOWN_COLOR, isClusterCountUnavailable, type ColorBy, type HazardOverlay, type MapFeature, type MapFilter } from '../lib/map/index.ts'

const tilesUrl = `${DATA_BASE_URL || window.location.origin}/tiles/shelters.pmtiles`
const pointsUrl = `${DATA_BASE_URL || window.location.origin}/tiles/points.pmtiles`

export function MapPage() {
  const [filter, setFilter] = useState<MapFilter>({ kind: 'all', hazard: 'all', states: [...DISPLAY_STATES], ac: 'all', overlap: 'all' })
  const [selected, setSelected] = useState<MapFeature | null>(null)
  const [overlay, setOverlay] = useState<HazardOverlay | null>(null)
  // 設備の情報はほぼ公表されていないため、最初は分かっている指標（洪水の浸水深）で色分けする（DATA_NOTES 14.5）
  const [colorBy, setColorBy] = useState<ColorBy>('flood')
  const [panelOpen, setPanelOpen] = useState(false)
  // 前回見ていた場所（なければ保存した場所）から表示する。どちらもなければ全国
  const [initialView] = useState(() => loadMapView())
  const [target, setTarget] = useState<{ lat: number; lng: number; zoom: number } | null>(null)
  const filtered = filter.kind !== 'all' || filter.hazard !== 'all' || filter.ac !== 'all' || filter.overlap !== 'all' || filter.states.length !== DISPLAY_STATES.length || overlay !== null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 全国の概況：PC は地図の上に 1 行。スマホは絞り込みの中に出す（SPEC §6.1） */}
      <div className="hidden border-b border-line bg-surface px-4 py-1.5 md:block"><NationalSummary /></div>

      <div className="relative h-[calc(100dvh-12.5rem)] min-h-[360px] md:h-auto md:min-h-0 md:flex-1">
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

        {/* 上：検索と色分けだけを置く */}
        <div className="pointer-events-none absolute inset-x-3 top-3 z-20 flex flex-col gap-2 md:right-auto md:w-[26rem]">
          <SearchBox
            onGo={(lat, lng, zoom) => { setSelected(null); setPanelOpen(false); setTarget({ lat, lng, zoom }) }}
            panelOpen={panelOpen}
            filtered={filtered}
            onTogglePanel={() => setPanelOpen((v) => !v)}
          />
          <label className="pointer-events-auto flex w-fit items-center gap-1 rounded-full bg-white/95 py-0.5 pl-3 pr-1 text-sm shadow-md ring-1 ring-black/5">
            <span className="text-ink-soft">{ja.colorBy.label}</span>
            <select value={colorBy} onChange={(e) => setColorBy(e.target.value as ColorBy)} className="min-h-9 rounded-full border-0 bg-transparent pr-1 text-sm font-bold">
              {COLOR_BYS.map((c) => <option key={c} value={c}>{ja.colorBy.names[c]}</option>)}
            </select>
          </label>
        </div>

        {/* 絞り込み・凡例・ハザードマップ：検索の下に開くパネル */}
        {panelOpen && (
          <div
            id="filter-panel"
            className="absolute inset-x-3 top-[7.5rem] bottom-3 z-30 overflow-y-auto rounded-2xl bg-surface shadow-2xl ring-1 ring-black/5 md:bottom-auto md:right-auto md:max-h-[calc(100%-8.5rem)] md:w-[26rem]"
          >
            <div className="sticky top-0 flex items-center justify-between bg-surface px-4 pt-2">
              <h2 className="m-0 text-lg font-bold">{ja.map.panelTitle}</h2>
              <button type="button" onClick={() => setPanelOpen(false)} aria-label={ja.search.close} className="h-11 w-11 rounded-full text-2xl leading-none hover:bg-paper">×</button>
            </div>
            <div className="space-y-5 px-4 pb-5 text-base">
              {colorBy === 'state' ? <Legend /> : <MetricLegend colorBy={colorBy} />}
              <section className="space-y-2">
                <h3 className="m-0 text-base font-bold">{ja.map.filters}</h3>
                <ToggleButton on={filter.overlap === 'only'} onClick={() => setFilter({ ...filter, overlap: filter.overlap === 'only' ? 'all' : 'only' })}>
                  {ja.map.overlapOnly}
                </ToggleButton>
                <ToggleButton on={filter.ac === 'none'} onClick={() => setFilter({ ...filter, ac: filter.ac === 'none' ? 'all' : 'none' })}>
                  {ja.map.acNone}
                </ToggleButton>
                <FilterControls filter={filter} onChange={setFilter} />
                {isClusterCountUnavailable(filter) && colorBy === 'state' && (
                  <p role="status" className="m-0 rounded bg-paper p-2 text-sm">{ja.map.clusterCountUnavailable}</p>
                )}
              </section>
              <HazardOverlayPicker value={overlay} onChange={setOverlay} />
              <section className="rounded-xl bg-paper p-3 text-sm md:hidden"><NationalSummary /></section>
              <p className="m-0 text-sm"><Link to="/list">{ja.map.listAlternative}</Link></p>
            </div>
          </div>
        )}

        {/* 凡例（常時表示。SPEC §3.6）：左下に小さく。避難所を選んでいる間は隠す */}
        {!panelOpen && !selected && (
          <div className="pointer-events-none absolute bottom-8 left-3 z-10 flex max-w-[calc(100%-5rem)] flex-wrap gap-x-2 gap-y-0.5 rounded-xl bg-white/90 px-2.5 py-1.5 text-xs shadow-md md:text-sm">
            {colorBy === 'state' ? (
              <>
                {DISPLAY_STATES.map((s) => <StateLabel key={s} state={s} />)}
                <span className="flex items-center gap-1"><AttentionMark />{ja.state.attentionShort}</span>
              </>
            ) : <MetricLegendItems colorBy={colorBy} />}
          </div>
        )}

        {selected && <SelectedSheet feature={selected} onClose={() => setSelected(null)} />}
      </div>
    </div>
  )
}

function NationalSummary() {
  const national = useNational()
  if (!national.data) return <p className="m-0 text-sm text-ink-soft">{national.isError ? ja.loadError : ja.loading}</p>
  return (
    <p className="m-0 text-sm">
      {ja.summary.facilities} <strong className="tabular-nums">{fmt.format(national.data.facility_count)}</strong> {ja.unitFacilities}
      <span className="mx-2 text-line">|</span>
      {ja.summary.withAmenity} <strong className="tabular-nums">{fmt.format(national.data.amenity_coverage.facilities_with_any)}</strong> {ja.unitFacilities}（{pct(national.data.amenity_coverage.ratio)}）
      <span className="block text-ink-soft md:inline md:ml-2">{ja.summary.withAmenityNote}</span>
    </p>
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
          ? 'flex w-full items-center justify-between rounded-xl bg-ink px-4 py-2.5 text-left text-base font-bold text-white'
          : 'flex w-full items-center justify-between rounded-xl bg-paper px-4 py-2.5 text-left text-base'
      }
    >
      <span>{children}</span>
      <span aria-hidden="true">{on ? '✓' : ''}</span>
    </button>
  )
}

const SearchIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
)
const FilterIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></svg>
)

/** 住所・地名で探す。入力に合わせて市区町村・町名の候補を出す。照合は端末の中だけ（D-33） */
function SearchBox({ onGo, panelOpen, filtered, onTogglePanel }: { onGo: (lat: number, lng: number, zoom: number) => void; panelOpen: boolean; filtered: boolean; onTogglePanel: () => void }) {
  const t = ja.search
  const index = useMuniIndex()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [message, setMessage] = useState<React.ReactNode>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // 入力に合わせて候補を作る。市区町村が 1 つに決まり、その先まで入力されていれば町名の候補を出す
  useEffect(() => {
    if (!index.data || !q.trim()) { setSuggestions([]); return }
    let cancelled = false
    const timer = setTimeout(() => {
      const munis = suggestMunis(q, index.data)
      setSuggestions(munis)
      const prefs = resolvePrefs(q, index.data)
      if (prefs.length === 1) {
        void loadGeocode(prefs[0]!.code).then((file) => {
          const towns = suggestTowns(q, prefs[0]!, file)
          if (!cancelled && towns.length > 0) setSuggestions(towns)
        }).catch(() => undefined)
      }
    }, 120)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [q, index.data])

  const goHit = (h: GeocodeHit) => onGo(h.lat, h.lng, h.level === 'town' ? 15 : 12)

  async function choose(sg: Suggestion) {
    setMessage(null)
    if (sg.kind === 'town') {
      setQ(sg.sub + sg.label); setOpen(false); inputRef.current?.blur(); goHit(sg.hit)
      return
    }
    // 市区町村を選んだら、その中心へ移動し、続けて町名を入力できるようにする
    setQ(sg.query)
    const r = await searchAddress(sg.query, index.data!, sg.pref).catch(() => null)
    if (r && (r.status === 'found' || r.status === 'muni_only')) goHit(r.hit)
    inputRef.current?.focus()
  }

  async function submit() {
    if (!q.trim() || !index.data) return
    const first = suggestions[0]
    if (first && (first.kind === 'town' || suggestions.length === 1)) { void choose(first); return }
    const r = await searchAddress(q, index.data).catch(() => null)
    if (!r) { setMessage(ja.loadError); return }
    if (r.status === 'found' || r.status === 'muni_only') { setOpen(false); inputRef.current?.blur(); goHit(r.hit); setMessage(r.status === 'muni_only' ? t.muniOnly(r.hit.muni.name) : null) }
    else if (r.status === 'choose_town') setSuggestions(r.candidates.map((c) => ({ kind: 'town' as const, label: c.town, sub: `${r.pref.name}${c.muni.name}`, hit: c })))
    else if (r.status === 'choose_pref') setMessage(t.choosePref)
    else if (first) void choose(first)
    else setMessage(t.notFound)
  }

  const showList = open && suggestions.length > 0
  return (
    <div className="pointer-events-auto relative">
      <form role="search" aria-label={t.label} onSubmit={(e) => { e.preventDefault(); void submit() }}
        className="flex items-center gap-1 rounded-full bg-white py-1 pl-4 pr-1 shadow-lg ring-1 ring-black/5">
        <span className="text-ink-soft"><SearchIcon /></span>
        <input
          ref={inputRef}
          type="search"
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); setMessage(null) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={t.placeholder}
          aria-label={t.label}
          aria-autocomplete="list"
          aria-controls="search-suggestions"
          aria-expanded={showList}
          enterKeyHint="search"
          autoComplete="off"
          className="min-h-11 min-w-0 flex-1 border-0 bg-transparent px-1 text-base outline-none"
        />
        <button
          type="button"
          onClick={onTogglePanel}
          aria-expanded={panelOpen}
          aria-controls="filter-panel"
          aria-label={ja.map.panelTitle}
          className={`relative grid h-11 w-11 shrink-0 place-items-center rounded-full ${panelOpen ? 'bg-ink text-white' : 'hover:bg-paper'}`}
        >
          <FilterIcon />
          {filtered && !panelOpen && <span aria-hidden="true" className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-state-critical" />}
        </button>
      </form>
      {showList && (
        <ul id="search-suggestions" role="listbox" className="absolute inset-x-0 top-full z-40 m-0 mt-2 max-h-[50vh] list-none overflow-y-auto rounded-2xl bg-white p-1 shadow-2xl ring-1 ring-black/5">
          {suggestions.map((sg) => (
            <li key={sg.kind + sg.sub + sg.label} role="option" aria-selected={false}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => void choose(sg)}
                className="flex w-full items-baseline gap-2 rounded-xl px-3 py-2.5 text-left hover:bg-paper">
                <span className="text-base font-bold">{sg.label}</span>
                <span className="truncate text-sm text-ink-soft">{sg.sub}</span>
              </button>
            </li>
          ))}
          <li className="px-3 pb-1 pt-1 text-xs text-ink-soft">{t.privacy}</li>
        </ul>
      )}
      {message && !showList && <p role="status" className="m-0 mt-2 rounded-xl bg-white px-3 py-2 text-sm shadow-lg">{message}</p>}
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
    <section aria-label={ja.state.legend}>
      <h3 className="m-0 mb-1 text-base font-bold">{ja.colorBy.names.state}</h3>
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
      <details className="mt-2 text-sm text-ink-soft">
        <summary className="cursor-pointer">{ja.map.aboutColors}</summary>
        <p className="m-0 mt-1">{ja.state.phase1Note}</p>
        <p className="m-0 mt-1">{ja.colorBy.stateNote}</p>
      </details>
    </section>
  )
}

/** 選んだ避難所。スマホは下から大きく出し、PC は右上に置く。いちばん大事な「名前」と「詳細へ」を大きく */
function SelectedSheet({ feature, onClose }: { feature: MapFeature; onClose: () => void }) {
  const t = ja.colorBy
  const m = feature.metrics
  const unknown = ja.map.unknownShort
  const depth = (v: number | undefined) => (v === undefined ? unknown : t.depthClasses[v]!)
  const facts: [string, string, boolean][] = [
    [t.names.flood, depth(m.flood), (m.flood ?? 0) >= 3],
    [t.names.tsunami, depth(m.tsunami), (m.tsunami ?? 0) >= 3],
    [t.names.landslide, m.landslide === undefined ? unknown : t.landslideClasses[m.landslide]!, (m.landslide ?? 0) >= 1],
    [t.names.road, m.road === undefined ? unknown : t.roadClasses[m.road]!, false],
  ]
  if (m.storm_surge !== undefined && m.storm_surge > 0) facts.splice(2, 0, [t.names.storm_surge, depth(m.storm_surge), m.storm_surge >= 3])
  return (
    <section
      aria-live="polite"
      aria-label={feature.name}
      className="absolute inset-x-0 bottom-0 z-30 max-h-[75%] overflow-y-auto rounded-t-3xl bg-surface px-5 pb-5 pt-2 shadow-[0_-8px_30px_rgba(0,0,0,0.18)] md:inset-x-auto md:bottom-auto md:right-3 md:top-3 md:w-[24rem] md:rounded-3xl"
    >
      <div aria-hidden="true" className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-line md:hidden" />
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="m-0 flex flex-wrap gap-x-2 text-sm text-ink-soft">
            {feature.kind & KIND_SHELTER ? <span>{ja.kind.shelter}</span> : null}
            {feature.kind & KIND_EMERGENCY ? <span>{ja.kind.emergency}</span> : null}
            {feature.restrictedOnly && <span className="font-bold text-ink">{ja.kind.restrictedShort}</span>}
          </p>
          <h2 className="m-0 mt-0.5 text-2xl font-bold leading-tight">{feature.name}</h2>
        </div>
        <button type="button" onClick={onClose} aria-label={ja.map.selectedClose} className="-mr-2 h-11 w-11 shrink-0 rounded-full text-2xl leading-none hover:bg-paper">×</button>
      </div>
      {feature.attention && (
        <p className="m-0 mt-3 flex items-center gap-2 rounded-xl bg-paper px-3 py-2 text-sm font-bold"><AttentionMark />{ja.map.attentionSheet}</p>
      )}
      <dl className="m-0 mt-3 grid grid-cols-2 gap-2">
        {facts.map(([k, v, strong]) => (
          <div key={k} className="rounded-xl bg-paper px-3 py-2">
            <dt className="text-xs text-ink-soft">{k}</dt>
            <dd className={`m-0 text-base ${strong ? 'font-bold' : ''}`}>{v}</dd>
          </div>
        ))}
        <div className="col-span-2 rounded-xl bg-paper px-3 py-2">
          <dt className="text-xs text-ink-soft">{t.names.state}</dt>
          <dd className="m-0 text-base"><StateLabel state={feature.state} restrictedOnly={feature.restrictedOnly} /></dd>
        </div>
      </dl>
      <Link to="/f/$muniKey/$facilityId" params={{ muniKey: feature.muni, facilityId: feature.id }}
        className="mt-4 flex min-h-12 w-full items-center justify-center rounded-full bg-ink text-base font-bold text-white no-underline">
        {ja.map.openDetail} ›
      </Link>
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
    <section aria-label={ja.state.legend}>
      <h3 className="m-0 mb-1 text-base font-bold">{t.names[colorBy]}</h3>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm"><MetricLegendItems colorBy={colorBy} /></div>
      <details className="mt-2 text-sm text-ink-soft">
        <summary className="cursor-pointer">{ja.map.aboutColors}</summary>
        <p className="m-0 mt-1">{note}</p>
        <p className="m-0 mt-1">{t.stateNote}</p>
      </details>
    </section>
  )
}
