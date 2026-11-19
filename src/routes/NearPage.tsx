// 住所から近くの避難所を探す（SPEC §6.6、DATA_NOTES 13 章）。
// 住所は端末の中だけで町丁目の代表点に照合し、本サービスにも外部にも送らない（D-33）。
import { Link } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { geocode, nearest, NEAR_RADIUS_M, pointCells, type GeocodeHit, type GeocodeResult, type PointRow } from '../../shared/geocode.ts'
import { HAZARD_KEYS, type DisplayState } from '../../shared/types.ts'
import { MapView } from '../components/MapView.tsx'
import { StateLabel } from '../components/StateMark.tsx'
import { ja } from '../i18n/ja.ts'
import { DATA_BASE_URL, fetchGeocode, fetchPoints, useMuniIndex } from '../lib/data.ts'
import { loadPlaces, savePlaces, type SavedPlace } from '../lib/places.ts'

const tilesUrl = `${DATA_BASE_URL || window.location.origin}/tiles/shelters.pmtiles`
/** 3km 以内に施設がないときに、最寄りを探す範囲 */
const FALLBACK_RADIUS_M = 30_000
/** 最初に一覧に出す件数。都市部では 3km 以内に数十件あるため */
const LIST_LIMIT = 20

type Spot = { lat: number; lng: number; zoom: number; label: string; prefCode: string; muniKey: string | null; adjusted: boolean }

export function NearPage() {
  const t = ja.near
  const index = useMuniIndex()
  const [prefCode, setPrefCode] = useState('')
  const [address, setAddress] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<GeocodeResult | null>(null)
  const [spot, setSpot] = useState<Spot | null>(null)
  const [places, setPlaces] = useState<SavedPlace[]>(() => loadPlaces())

  const applyHit = (h: GeocodeHit) =>
    setSpot({ lat: h.lat, lng: h.lng, zoom: h.level === 'town' ? 15 : 13, label: `${h.muni.name}${h.town}`, prefCode, muniKey: h.muni.key, adjusted: false })

  async function search(e: React.FormEvent) {
    e.preventDefault()
    if (!prefCode || !address.trim()) return
    setBusy(true); setError(null); setResult(null); setSpot(null)
    try {
      // 取得するのは都道府県の照合用ファイルだけ。住所はこの端末の中で照合する
      const file = await fetchGeocode(prefCode)
      const r = geocode(address, file)
      setResult(r)
      if (r.status === 'found') applyHit(r.hit)
      else if (r.status === 'not_found' && r.muni) applyHit(r.muni)
    } catch {
      setError(ja.loadError)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-5">
      <h1 className="m-0 text-2xl font-bold">{t.title}</h1>
      <p className="m-0 mt-1 text-base">{t.intro}</p>
      <p className="m-0 mt-1 rounded bg-paper p-2 text-sm">{t.privacy}</p>

      <form onSubmit={(e) => void search(e)} className="mt-3 grid gap-2 rounded border border-line bg-surface p-3 sm:grid-cols-[12rem_1fr_auto] sm:items-end">
        <label className="grid gap-1 text-base">
          <span>{t.pref}</span>
          <select required value={prefCode} onChange={(e) => setPrefCode(e.target.value)} className="min-h-11 rounded border border-line bg-white px-2">
            <option value="">{t.prefPlaceholder}</option>
            {index.data?.prefs.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-base">
          <span>{t.address}</span>
          <input required value={address} onChange={(e) => setAddress(e.target.value)} placeholder={t.addressPlaceholder}
            autoComplete="off" className="min-h-11 rounded border border-line bg-white px-2" />
        </label>
        <button type="submit" disabled={busy} className="min-h-11 rounded bg-ink px-5 text-base font-bold text-white">{busy ? ja.loading : t.search}</button>
      </form>

      {places.length > 0 && (
        <section aria-labelledby="saved-h" className="mt-3 text-base">
          <h2 id="saved-h" className="m-0 text-base font-bold">{t.saved}</h2>
          <ul className="m-0 mt-1 flex list-none flex-wrap gap-2 p-0">
            {places.map((p, i) => (
              <li key={`${p.label}-${i}`} className="flex items-center gap-1 rounded border border-line bg-surface pl-3">
                <button type="button" className="min-h-11 font-bold" onClick={() => setSpot({ ...p, zoom: 15, adjusted: false })}>{p.label}</button>
                <button type="button" className="min-h-11 px-3 text-ink-soft" aria-label={t.removeSaved(p.label)}
                  onClick={() => { const next = places.filter((_, j) => j !== i); setPlaces(next); savePlaces(next) }}>×</button>
              </li>
            ))}
          </ul>
          <p className="m-0 mt-1 text-sm text-ink-soft">{t.savedNote}</p>
        </section>
      )}

      {error && <p role="alert" className="mt-3">{error}</p>}
      {result?.status === 'choose' && (
        <section className="mt-3 rounded border border-line bg-surface p-3 text-base">
          <p className="m-0 font-bold">{t.choose}</p>
          <ul className="m-0 mt-1 flex list-none flex-wrap gap-2 p-0">
            {result.candidates.map((c) => (
              <li key={c.town}><button type="button" onClick={() => applyHit(c)} className="min-h-11 rounded border border-ink px-3">{c.town}</button></li>
            ))}
          </ul>
        </section>
      )}
      {result?.status === 'not_found' && <p role="status" className="mt-3 rounded border border-line bg-surface p-3">{result.muni ? t.notFoundTown : t.notFound}</p>}

      {spot && (
        <Nearby spot={spot} onMove={(lat, lng) => setSpot({ ...spot, lat, lng, adjusted: true, zoom: spot.zoom })}
          onSave={(label) => { const next = [...places, { label, lat: spot.lat, lng: spot.lng, prefCode: spot.prefCode, muniKey: spot.muniKey }]; setPlaces(next); savePlaces(next) }} />
      )}
      <p className="mt-4 text-sm text-ink-soft">{t.source}</p>
    </div>
  )
}

function Nearby({ spot, onMove, onSave }: { spot: Spot; onMove: (lat: number, lng: number) => void; onSave: (label: string) => void }) {
  const t = ja.near
  const [rows, setRows] = useState<PointRow[] | null>(null)
  const [fallback, setFallback] = useState(false)
  const [error, setError] = useState(false)
  const [label, setLabel] = useState('')
  const [saved, setSaved] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const { lat, lng } = spot
  useEffect(() => {
    const at = { lat, lng }
    let cancelled = false
    setRows(null); setError(false); setSaved(false); setShowAll(false)
    void (async () => {
      try {
        // 地点の周辺の区画（緯度経度 1 度）だけを取得する
        let r = await fetchPoints(pointCells(lat, lng, NEAR_RADIUS_M))
        let fb = false
        if (nearest(r, at).mode === 'nearest' && nearest(r, at).items.length < 5) {
          r = await fetchPoints(pointCells(lat, lng, FALLBACK_RADIUS_M))
          fb = true
        }
        if (!cancelled) { setRows(r); setFallback(fb) }
      } catch {
        if (!cancelled) setError(true)
      }
    })()
    return () => { cancelled = true }
  }, [lat, lng])
  const near = useMemo(() => (rows ? nearest(rows, { lat, lng }) : null), [rows, lat, lng])
  const hazardUrl = `https://disaportal.gsi.go.jp/hazardmap/maps/index.html?ll=${spot.lat.toFixed(5)},${spot.lng.toFixed(5)}&z=16&base=pale`

  return (
    <section aria-labelledby="near-h" className="mt-3">
      <h2 id="near-h" className="m-0 text-xl font-bold">{t.resultTitle}</h2>
      <p className="m-0 mt-1 text-base">{spot.adjusted ? t.adjusted : t.located(spot.label)}</p>
      <p className="m-0 mt-1 text-sm text-ink-soft">{t.precision}</p>
      <MapView mode="pick" tilesUrl={tilesUrl} lat={spot.lat} lng={spot.lng} zoom={spot.zoom} onPick={onMove}
        label={t.mapLabel} className="mt-2 h-80 w-full overflow-hidden rounded border border-line" />

      <ul className="m-0 mt-2 list-disc pl-5 text-sm">
        {t.notes.map((n) => <li key={n}>{n}</li>)}
      </ul>
      <p className="m-0 mt-2 text-base">
        <a href={hazardUrl} target="_blank" rel="noreferrer">{t.hazardLink}</a>
        <span className="block text-sm text-ink-soft">{t.hazardLinkNote}</span>
      </p>
      {spot.muniKey && (
        <p className="m-0 mt-1 text-base">
          <Link to="/list/$prefCode/$muniKey" params={{ prefCode: spot.muniKey.slice(0, 2), muniKey: spot.muniKey }}>{t.muniLink}</Link>
        </p>
      )}

      <h3 className="m-0 mt-4 text-lg font-bold">{fallback || near?.mode === 'nearest' ? t.nearestTitle : t.radiusTitle}</h3>
      {error && <p role="alert">{ja.loadError}</p>}
      {!rows && !error && <p role="status">{ja.loading}</p>}
      {near && near.items.length === 0 && <p>{t.none}</p>}
      {near && (
        <ol className="m-0 mt-1 list-none p-0">
          {(showAll ? near.items : near.items.slice(0, LIST_LIMIT)).map(({ row, d }) => {
            const [id, muniKey, name, , , kind, state, rs, hm, hz] = row
            const hazards = HAZARD_KEYS.filter((_, i) => hz & (1 << i)).map((k) => ja.hazard.names[k])
            return (
              <li key={id} className="border-b border-line py-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <Link to="/f/$muniKey/$facilityId" params={{ muniKey, facilityId: id }} className="text-lg font-bold">{name}</Link>
                  <span className="text-base tabular-nums">{t.distance(d)}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <StateLabel state={state as DisplayState} restrictedOnly={rs === 1} />
                  {kind & 1 ? <span className="rounded border border-line px-1.5">{ja.kind.emergency}</span> : null}
                  {kind & 2 ? <span className="rounded border border-line px-1.5">{ja.kind.shelter}</span> : null}
                  {rs === 1 && <span className="rounded border border-ink px-1.5 font-bold">{ja.kind.restrictedShort}</span>}
                  {hm === 1 && <span className="rounded border-2 border-state-critical px-1.5 font-bold"><span aria-hidden="true">! </span>{t.attention}</span>}
                </div>
                {hazards.length > 0 && <p className="m-0 mt-0.5 text-sm text-ink-soft">{t.hazards(hazards.join('、'))}</p>}
              </li>
            )
          })}
        </ol>
      )}
      {near && !showAll && near.items.length > LIST_LIMIT && (
        <button type="button" onClick={() => setShowAll(true)} className="mt-2 min-h-11 rounded border-2 border-ink px-4 text-base font-bold">{t.showAll(near.items.length)}</button>
      )}

      <form className="mt-4 rounded border border-line bg-surface p-3 text-base"
        onSubmit={(e) => { e.preventDefault(); if (label.trim()) { onSave(label.trim()); setSaved(true); setLabel('') } }}>
        <label className="grid gap-1">
          <span className="font-bold">{t.saveTitle}</span>
          <span className="text-sm text-ink-soft">{t.saveNote}</span>
          <span className="flex gap-2">
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t.savePlaceholder} maxLength={20}
              className="min-h-11 flex-1 rounded border border-line bg-white px-2" />
            <button type="submit" className="min-h-11 rounded border-2 border-ink px-4 font-bold">{t.save}</button>
          </span>
        </label>
        {saved && <p role="status" className="m-0 mt-1 text-sm">{t.savedDone}</p>}
      </form>
    </section>
  )
}
