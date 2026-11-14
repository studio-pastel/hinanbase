import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { DISPLAY_STATES, HAZARD_KEYS, KIND_EMERGENCY, KIND_SHELTER, type DisplayState, type HazardKey } from '../../shared/types.ts'
import { MapView } from '../components/MapView.tsx'
import { StateLabel, StateMark } from '../components/StateMark.tsx'
import { fmt, ja, pct } from '../i18n/ja.ts'
import { DATA_BASE_URL, useNational } from '../lib/data.ts'
import { isClusterCountUnavailable, type MapFeature, type MapFilter } from '../lib/map/index.ts'

const tilesUrl = `${DATA_BASE_URL || window.location.origin}/tiles/shelters.pmtiles`

export function MapPage() {
  const national = useNational()
  const [filter, setFilter] = useState<MapFilter>({ kind: 'all', hazard: 'all', states: [...DISPLAY_STATES], ac: 'all' })
  const [selected, setSelected] = useState<MapFeature | null>(null)
  const [panelOpen, setPanelOpen] = useState(() => window.matchMedia('(min-width: 768px)').matches)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <section aria-label={ja.summary.label} className="flex flex-wrap items-baseline gap-x-6 gap-y-0.5 border-b border-line bg-surface px-4 py-1.5 text-sm">
        {national.data ? (
          <>
            <p className="m-0">
              {ja.summary.facilities}{' '}
              <strong className="text-base tabular-nums">{fmt.format(national.data.facility_count)}</strong> {ja.unitFacilities}
            </p>
            <p className="m-0">
              {ja.summary.withAmenity}{' '}
              <strong className="text-base tabular-nums">
                {fmt.format(national.data.amenity_coverage.facilities_with_any)}
              </strong>{' '}
              {ja.unitFacilities}（{pct(national.data.amenity_coverage.ratio)}）
            </p>
            <p className="m-0 text-xs text-ink-soft">{ja.summary.withAmenityNote}</p>
          </>
        ) : (
          <p className="m-0 text-ink-soft" role={national.isError ? 'alert' : 'status'}>
            {national.isError ? ja.loadError : ja.loading}
          </p>
        )}
      </section>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="relative min-h-[55vh] flex-1">
          <MapView
            mode="national"
            tilesUrl={tilesUrl}
            className="absolute inset-0"
            label={ja.map.label}
            filter={filter}
            selectedId={selected?.id ?? null}
            onSelect={setSelected}
          />
          {selected && <SelectedCard feature={selected} onClose={() => setSelected(null)} />}
        </div>

        {/* 絞り込み：PC は地図の左に重ねる。モバイルは地図の下に置き、地図の出典表示を隠さない（SPEC §6.1） */}
        <div className="z-10 max-h-[60vh] overflow-y-auto border-t border-line bg-surface md:absolute md:left-3 md:top-3 md:max-h-[calc(100%-1.5rem)] md:w-80 md:rounded md:border md:shadow-lg">
          <button
            type="button"
            className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm font-bold"
            aria-expanded={panelOpen}
            aria-controls="filter-panel"
            onClick={() => setPanelOpen((v) => !v)}
          >
            <span>{ja.map.filters}・{ja.state.legend}</span>
            <span aria-hidden="true">{panelOpen ? '−' : '＋'}</span>
          </button>
          {/* 「冷房なしだけを表示」はワンタップで（SPEC §6.1）。パネルを閉じていても押せる */}
          <div className="px-4 pb-2">
            <button
              type="button"
              aria-pressed={filter.ac === 'none'}
              onClick={() => setFilter({ ...filter, ac: filter.ac === 'none' ? 'all' : 'none' })}
              className={
                filter.ac === 'none'
                  ? 'w-full rounded border-2 border-ink bg-ink px-3 py-2 text-sm font-bold text-white'
                  : 'w-full rounded border-2 border-ink bg-white px-3 py-2 text-sm font-bold'
              }
            >
              {filter.ac === 'none' ? ja.map.acNoneOn : ja.map.acNone}
            </button>
            {filter.ac === 'none' && <p className="m-0 mt-1 text-xs text-ink-soft">{ja.map.acNoneHelp}</p>}
          </div>
          <div id="filter-panel" hidden={!panelOpen} className="space-y-4 px-4 pb-4 text-sm">
            <FilterControls filter={filter} onChange={setFilter} />
            <Legend />
            <p className="m-0">
              <Link to="/list">{ja.map.listAlternative}</Link>
            </p>
          </div>
          {isClusterCountUnavailable(filter) && (
            <p role="status" className="m-0 mx-4 mb-2 rounded bg-paper p-2 text-xs">{ja.map.clusterCountUnavailable}</p>
          )}
          {/* 凡例は常時表示（SPEC §3.6）。パネルを閉じていても1行で出す */}
          {!panelOpen && (
            <div className="flex flex-wrap gap-x-3 gap-y-1 px-4 pb-2 text-xs">
              {DISPLAY_STATES.map((s) => <StateLabel key={s} state={s} />)}
            </div>
          )}
        </div>
      </div>
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
        <span id="hazard-help" className="mt-1 block text-xs text-ink-soft">{ja.hazard.help}</span>
      </label>
      <fieldset className="m-0 border-0 p-0">
        <legend className="mb-1 font-bold">{ja.state.label}</legend>
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          {DISPLAY_STATES.map((s) => (
            <label key={s} className="flex items-center gap-1.5">
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
      <h2 className="m-0 mb-1 text-sm font-bold">{ja.state.legend}</h2>
      <ul className="m-0 list-none space-y-1 p-0 text-xs">
        {DISPLAY_STATES.map((s) => (
          <li key={s} className="flex gap-2">
            <StateMark state={s} />
            <span><strong>{ja.state.names[s]}</strong>：{ja.state.descriptions[s]}</span>
          </li>
        ))}
        <li className="flex gap-2"><StateMark state="unknown" restrictedOnly /><span>{ja.state.restrictedLegend}</span></li>
        <li>{ja.state.clusterLegend}</li>
      </ul>
      <p className="m-0 mt-2 text-xs text-ink-soft">{ja.state.phase1Note}</p>
    </section>
  )
}

function SelectedCard({ feature, onClose }: { feature: MapFeature; onClose: () => void }) {
  return (
    <section
      aria-live="polite"
      className="absolute left-3 right-3 top-3 z-20 rounded border border-line bg-surface p-3 shadow-lg md:left-auto md:right-14 md:w-80"
    >
      <div className="flex items-start gap-2">
        <h2 className="m-0 flex-1 text-base font-bold leading-snug">{feature.name}</h2>
        <button type="button" onClick={onClose} aria-label={ja.map.selectedClose} className="rounded px-2 text-lg leading-none hover:bg-paper">×</button>
      </div>
      <ul className="m-0 mt-1 flex list-none flex-wrap gap-1.5 p-0 text-xs">
        {feature.kind & KIND_EMERGENCY ? <li className="rounded border border-line px-1.5 py-0.5">{ja.kind.emergency}</li> : null}
        {feature.kind & KIND_SHELTER ? <li className="rounded border border-line px-1.5 py-0.5">{ja.kind.shelter}</li> : null}
        {feature.restrictedOnly && <li className="rounded border border-ink px-1.5 py-0.5 font-bold">{ja.kind.restrictedShort}</li>}
      </ul>
      <p className="m-0 mt-2 text-sm"><StateLabel state={feature.state} restrictedOnly={feature.restrictedOnly} /></p>
      <p className="m-0 mt-2 text-sm">
        <Link to="/f/$muniKey/$facilityId" params={{ muniKey: feature.muni, facilityId: feature.id }}>
          {ja.map.openDetail}
        </Link>
      </p>
    </section>
  )
}
