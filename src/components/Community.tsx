// 施設詳細ページの市民投稿まわり：異議の申し立てフォームと編集履歴
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ja, jstDate } from '../i18n/ja.ts'
import { amenityByKey, formatValue, type AmenityDef } from '../lib/amenities.ts'
import { useAuth } from '../lib/auth.tsx'
import { raiseDispute, useFacilityHistory, type AmenityJson } from '../lib/community.ts'
import { SignInButton } from './SignIn.tsx'
import { ValueInput } from './ValueInput.tsx'

const dateOf = jstDate

export function DisputeForm({ facilityId, def, onClose }: { facilityId: string; def: AmenityDef; onClose: () => void }) {
  const auth = useAuth()
  const queryClient = useQueryClient()
  const [reason, setReason] = useState('')
  const [counter, setCounter] = useState<AmenityJson | null>(null)
  const [evidence, setEvidence] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setState('sending')
    setError(null)
    try {
      await raiseDispute({ facilityId, amenityKey: def.key, reason, counterValue: counter, evidenceUrl: evidence.trim() || null })
      setState('done')
      void queryClient.invalidateQueries({ queryKey: ['live-amenities', facilityId] })
      void queryClient.invalidateQueries({ queryKey: ['history', facilityId] })
    } catch (e) {
      setError(`${ja.community.error}：${(e as Error).message}`)
      setState('idle')
    }
  }

  return (
    <div className="mt-2 rounded border-2 border-ink bg-paper p-3 text-sm">
      <p className="m-0 font-bold">{ja.community.dispute.title(def.label_ja)}</p>
      {state === 'done' ? (
        <p role="status" className="m-0 mt-2">{ja.community.dispute.done}</p>
      ) : !auth.session ? (
        <div className="mt-2 space-y-2">
          <p className="m-0">{ja.auth.required}</p>
          <SignInButton />
        </div>
      ) : (
        <form className="mt-2 space-y-2" onSubmit={(e) => { e.preventDefault(); void submit() }}>
          <p className="m-0 text-xs text-ink-soft">{ja.community.dispute.intro}</p>
          <label className="block">
            <span className="mb-1 block font-bold">{ja.community.dispute.reasonLabel}</span>
            <textarea required minLength={5} maxLength={1000} rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
              className="w-full rounded border border-line bg-white px-2 py-1.5" />
          </label>
          <div>
            <span className="mb-1 block font-bold">{ja.community.dispute.counterLabel}</span>
            <ValueInput def={def} value={counter} onChange={setCounter} name={`counter-${def.key}`} allowEmpty={ja.community.dispute.counterNone} />
          </div>
          <label className="block">
            <span className="mb-1 block font-bold">{ja.community.dispute.evidenceLabel}</span>
            <input type="url" placeholder="https://" value={evidence} onChange={(e) => setEvidence(e.target.value)}
              className="w-full rounded border border-line bg-white px-2 py-1.5" />
          </label>
          {error && <p role="alert" className="m-0 font-bold">{error}</p>}
          <button type="submit" disabled={state === 'sending'} className="rounded bg-ink px-3 py-1.5 font-bold text-white disabled:opacity-60">
            {ja.community.dispute.submit}
          </button>
        </form>
      )}
      <button type="button" onClick={onClose} className="mt-2 underline">
        {state === 'done' ? ja.map.selectedClose : ja.community.dispute.cancel}
      </button>
    </div>
  )
}

/** 編集履歴。誰でも読める（SPEC §4.4）。投稿者は匿名の記号で表示する */
export function History({ facilityId }: { facilityId: string }) {
  const history = useFacilityHistory(facilityId)
  if (!history.data) {
    return history.isError ? <p className="text-sm text-ink-soft">{ja.community.liveError}</p> : null
  }
  const { reports, disputes } = history.data
  return (
    <section aria-labelledby="history-h">
      <h2 id="history-h" className="m-0 text-lg font-bold">{ja.community.history.title}</h2>
      <p className="m-0 mb-2 text-xs text-ink-soft">{ja.community.history.intro}</p>
      {reports.length === 0 && disputes.length === 0 && (
        <p className="m-0 rounded border border-line bg-surface p-3 text-sm">{ja.community.history.empty}</p>
      )}
      {reports.length > 0 && (
        <ol className="m-0 list-none space-y-2 p-0 text-sm">
          {reports.map((r) => {
            const def = amenityByKey.get(r.amenity_key)
            return (
              <li key={r.id} className="rounded border border-line bg-surface p-3">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <strong>{def?.label_ja ?? r.amenity_key}：{formatValue(def, r.value)}</strong>
                  <span className="rounded border border-line px-1.5 text-xs">{ja.community.status[r.status]}</span>
                </div>
                <div className="text-xs text-ink-soft">
                  {dateOf(r.created_at)}・{ja.community.basis[r.basis]}・{ja.community.observedAt} {r.observed_at}・
                  {ja.community.history.reporter} {ja.community.reporterRole[r.reporter_role]} #{r.reporter_tag}
                </div>
                {r.status === 'rejected' && r.reject_reason && (
                  <p className="m-0 mt-1">{ja.community.history.rejectReason}：{r.reject_reason}</p>
                )}
                {r.note && <p className="m-0 mt-1">{r.note}</p>}
                {r.source_url && (
                  <p className="m-0 mt-1 break-all"><a href={r.source_url} target="_blank" rel="noopener noreferrer nofollow">{r.source_url}</a></p>
                )}
                {r.photo_urls && r.photo_urls.length > 0 && (
                  <ul className="m-0 mt-2 flex list-none flex-wrap gap-2 p-0">
                    {r.photo_urls.map((u) => (
                      <li key={u}><a href={u} target="_blank" rel="noopener noreferrer"><img src={u} alt="" loading="lazy" className="h-24 w-24 rounded border border-line object-cover" /></a></li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ol>
      )}
      {disputes.length > 0 && (
        <>
          <h3 className="mb-1 mt-4 text-base font-bold">{ja.community.history.disputes}</h3>
          <ol className="m-0 list-none space-y-2 p-0 text-sm">
            {disputes.map((d) => {
              const def = amenityByKey.get(d.amenity_key)
              return (
                <li key={d.id} className="rounded border border-line bg-surface p-3">
                  <strong>{def?.label_ja ?? d.amenity_key}</strong>{' '}
                  <span className="rounded border border-line px-1.5 text-xs">
                    {d.status === 'open' ? ja.community.dispute.open : ja.community.dispute[d.status]}
                  </span>
                  <div className="text-xs text-ink-soft">{dateOf(d.created_at)}・#{d.raiser_tag}</div>
                  <p className="m-0 mt-1">
                    {ja.community.dispute.counterValue}：{d.counter_value === null ? ja.community.dispute.noCounter : formatValue(def, d.counter_value)}
                  </p>
                  {d.resolution_note && <p className="m-0 mt-1">{ja.community.history.resolution}：{d.resolution_note}</p>}
                </li>
              )
            })}
          </ol>
        </>
      )}
    </section>
  )
}
