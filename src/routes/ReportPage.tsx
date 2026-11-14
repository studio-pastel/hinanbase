import { useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { useState } from 'react'
import { Status } from '../components/Layout.tsx'
import { RequireSignIn } from '../components/SignIn.tsx'
import { ValueInput } from '../components/ValueInput.tsx'
import { ja } from '../i18n/ja.ts'
import { amenitiesByOnsiteRank, formatValue } from '../lib/amenities.ts'
import { submitReport, useLiveAmenities, type AmenityJson, type Basis, type ReportStatus } from '../lib/community.ts'
import { useMuni } from '../lib/data.ts'
import { uploadPhoto } from '../lib/photo.ts'
import { PHOTO_UPLOAD_ENABLED } from '../lib/supabase.ts'

const BASES: Basis[] = ['on_site', 'photo', 'official_doc', 'hearsay']
const todayJst = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date())

export function ReportPage() {
  const { muniKey, facilityId } = useParams({ from: '/f/$muniKey/$facilityId/report' })
  const muni = useMuni(muniKey)
  const facility = muni.data?.facilities.find((f) => f.id === facilityId)
  return (
    <div className="mx-auto w-full max-w-2xl space-y-5 px-4 py-5">
      <p className="m-0 text-base">
        <Link to="/f/$muniKey/$facilityId" params={{ muniKey, facilityId }}>‹ {ja.community.report.backToFacility}</Link>
      </p>
      <h1 className="m-0 text-2xl font-bold">{ja.community.report.title}</h1>
      {!facility && <Status loading={muni.isLoading} error={muni.isError} />}
      {muni.data && !facility && <p role="alert">{ja.facility.notFound}</p>}
      {facility && (
        <>
          <p className="m-0 font-bold">{facility.name}</p>
          <RequireSignIn>
            <ReportSteps muniKey={muniKey} facilityId={facilityId} staticAmenities={facility.amenities} />
          </RequireSignIn>
        </>
      )}
    </div>
  )
}

function ReportSteps({
  muniKey, facilityId, staticAmenities,
}: {
  muniKey: string
  facilityId: string
  staticAmenities: Record<string, { value: AmenityJson; confidence: string }>
}) {
  const queryClient = useQueryClient()
  const live = useLiveAmenities(facilityId)
  const items = amenitiesByOnsiteRank
  const [basis, setBasis] = useState<Basis>('on_site')
  const [observedAt, setObservedAt] = useState(todayJst)
  const [sourceUrl, setSourceUrl] = useState('')
  const [photoUrls, setPhotoUrls] = useState<string[]>([])
  const [photoState, setPhotoState] = useState<'idle' | 'uploading' | 'failed'>('idle')
  const [index, setIndex] = useState(0)
  const [value, setValue] = useState<AmenityJson | null>(null)
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<{ key: string; status: ReportStatus }[]>([])

  const def = items[index]
  const go = (next: number) => { setIndex(next); setValue(null); setNote(''); setError(null) }
  const bases = BASES.filter((b) => b !== 'photo' || PHOTO_UPLOAD_ENABLED)

  if (!def) {
    return (
      <section aria-live="polite" className="rounded border border-line bg-surface p-4">
        <h2 className="m-0 text-xl font-bold">{ja.community.report.doneTitle}</h2>
        <p>{ja.community.report.doneSummary(results.length)}</p>
        <p className="text-base text-ink-soft">{ja.community.mapDelay}</p>
        <p className="m-0 flex flex-wrap gap-4">
          <Link to="/f/$muniKey/$facilityId" params={{ muniKey, facilityId }}>{ja.community.report.backToFacility}</Link>
          <button type="button" className="underline" onClick={() => go(0)}>{ja.community.report.restart}</button>
        </p>
      </section>
    )
  }

  const current = live.data?.[def.key] ?? staticAmenities[def.key]
  const last = results.at(-1)

  async function submit() {
    if (value === null || !def) { setError(ja.community.report.chooseValue); return }
    setSending(true)
    setError(null)
    try {
      const r = await submitReport({
        facilityId, amenityKey: def.key, value, basis, observedAt,
        sourceUrl: sourceUrl.trim() || null,
        photoUrls: basis === 'photo' && photoUrls.length > 0 ? photoUrls : null,
        note: note.trim() || null,
      })
      setResults((prev) => [...prev, { key: def.key, status: r.status }])
      void queryClient.invalidateQueries({ queryKey: ['live-amenities', facilityId] })
      void queryClient.invalidateQueries({ queryKey: ['history', facilityId] })
      go(index + 1)
    } catch (e) {
      setError(`${ja.community.error}：${(e as Error).message}`)
    } finally {
      setSending(false)
    }
  }

  async function addPhotos(files: FileList | null) {
    if (!files) return
    setPhotoState('uploading')
    try {
      const urls: string[] = []
      for (const f of [...files].slice(0, 4 - photoUrls.length)) urls.push(await uploadPhoto(f))
      setPhotoUrls((prev) => [...prev, ...urls])
      setPhotoState('idle')
    } catch {
      setPhotoState('failed')
    }
  }

  return (
    <div className="space-y-5">
      <p className="m-0 text-base text-ink-soft">{ja.community.report.intro}</p>

      <fieldset className="m-0 space-y-3 rounded border border-line bg-surface p-4">
        <legend className="px-1 font-bold">{ja.community.report.commonTitle}</legend>
        <div>
          <span className="mb-1 block text-base font-bold" id="basis-label">{ja.community.report.basisLabel}</span>
          <div role="radiogroup" aria-labelledby="basis-label" className="flex flex-col gap-1.5">
            {bases.map((b) => (
              <label key={b} className="flex min-h-12 items-center gap-3 rounded border border-line bg-white px-3">
                <input type="radio" name="basis" checked={basis === b} onChange={() => setBasis(b)} />
                {ja.community.basis[b]}
              </label>
            ))}
          </div>
          {!PHOTO_UPLOAD_ENABLED && <p className="m-0 mt-1 text-sm text-ink-soft">{ja.community.report.photoUnavailable}</p>}
        </div>
        <label className="block">
          <span className="mb-1 block text-base font-bold">{ja.community.report.observedLabel}</span>
          <input type="date" required max={todayJst()} value={observedAt} onChange={(e) => setObservedAt(e.target.value)}
            className="rounded border border-line bg-white px-2 py-1.5" />
        </label>
        {(basis === 'official_doc' || sourceUrl !== '') && (
          <label className="block">
            <span className="mb-1 block text-base font-bold">{ja.community.report.sourceUrlLabel}</span>
            <input type="url" inputMode="url" placeholder="https://" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)}
              aria-describedby="source-help" className="w-full rounded border border-line bg-white px-2 py-1.5" />
            <span id="source-help" className="mt-1 block text-sm text-ink-soft">{ja.community.report.sourceUrlHelp}</span>
          </label>
        )}
        {basis === 'photo' && PHOTO_UPLOAD_ENABLED && (
          <div>
            <label className="block">
              <span className="mb-1 block text-base font-bold">{ja.community.report.photoLabel}</span>
              <input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={photoUrls.length >= 4 || photoState === 'uploading'}
                aria-describedby="photo-help" onChange={(e) => { void addPhotos(e.target.files); e.target.value = '' }} />
            </label>
            <p id="photo-help" className="m-0 mt-1 text-sm text-ink-soft">{ja.community.report.photoHelp}</p>
            {photoState === 'uploading' && <p role="status" className="m-0 text-base">{ja.community.report.photoUploading}</p>}
            {photoState === 'failed' && <p role="alert" className="m-0 text-base">{ja.community.report.photoFailed}</p>}
            {photoUrls.length > 0 && (
              <ul className="m-0 mt-2 flex list-none flex-wrap gap-2 p-0">
                {photoUrls.map((u) => <li key={u}><img src={u} alt="" className="h-20 w-20 rounded border border-line object-cover" /></li>)}
              </ul>
            )}
          </div>
        )}
      </fieldset>

      {last && (
        <p role="status" className="m-0 rounded border border-line bg-paper p-2 text-base">
          {last.status === 'accepted' ? ja.community.report.resultAccepted : ja.community.report.resultPending}
        </p>
      )}

      <form className="space-y-3 rounded border-2 border-ink bg-surface p-4" onSubmit={(e) => { e.preventDefault(); void submit() }}>
        <p className="m-0 text-sm text-ink-soft">{ja.community.report.step(index + 1, items.length)}</p>
        <h2 className="m-0 text-2xl font-bold leading-snug">{def.label_ja}</h2>
        {def.help_text && <p className="m-0 text-base text-ink-soft">{def.help_text}</p>}
        <p className="m-0 text-base">
          {ja.community.report.current}：
          <strong>{current && current.confidence !== 'disputed' ? formatValue(def, current.value) : ja.facility.unknownValue}</strong>
        </p>
        <div>
          <span className="mb-1 block text-base font-bold">{ja.community.report.valueLabel}</span>
          <ValueInput def={def} value={value} onChange={setValue} name={`value-${def.key}`} />
        </div>
        <label className="block">
          <span className="mb-1 block text-base font-bold">{ja.community.report.noteLabel}</span>
          <textarea rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)}
            className="w-full rounded border border-line bg-white px-2 py-1.5" />
        </label>
        {error && <p role="alert" className="m-0 text-base font-bold">{error}</p>}
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <button type="submit" disabled={sending} className="min-h-12 rounded bg-ink px-5 text-lg font-bold text-white disabled:opacity-60">
            {sending ? ja.community.report.sending : ja.community.report.submit}
          </button>
          <button type="button" disabled={sending} onClick={() => go(index + 1)} className="min-h-12 rounded border border-ink px-5">
            {ja.community.report.skip}
          </button>
          {index > 0 && (
            <button type="button" disabled={sending} onClick={() => go(index - 1)} className="px-2 py-2 text-base underline">
              {ja.community.report.back}
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
