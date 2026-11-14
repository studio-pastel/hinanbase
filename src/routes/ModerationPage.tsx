import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { RequireSignIn } from '../components/SignIn.tsx'
import { ja, jstDate } from '../i18n/ja.ts'
import { amenityByKey, formatValue } from '../lib/amenities.ts'
import { useAuth } from '../lib/auth.tsx'
import { callRpc, type AmenityJson, type Basis } from '../lib/community.ts'
import { supabase } from '../lib/supabase.ts'

const t = ja.community.moderation
type Tab = keyof typeof t.tabs
const TABS = Object.keys(t.tabs) as Tab[]

export function ModerationPage() {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-5">
      <h1 className="m-0 text-2xl font-bold">{t.title}</h1>
      <RequireSignIn><Inner /></RequireSignIn>
    </div>
  )
}

function Inner() {
  const auth = useAuth()
  const [tab, setTab] = useState<Tab>('reports')
  // 画面の出し分けだけ。実際の権限はデータベース側で判定する
  if (!auth.isModerator) return <p role="alert">{t.forbidden}</p>
  return (
    <>
      <div role="tablist" aria-label={t.title} className="flex flex-wrap gap-1 border-b border-line">
        {TABS.map((k) => (
          <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k)}
            className={tab === k ? 'rounded-t border border-b-0 border-line bg-surface px-3 py-1.5 text-base font-bold' : 'px-3 py-1.5 text-base'}>
            {t.tabs[k]}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === 'reports' && <Reports />}
        {tab === 'disputes' && <Disputes />}
        {tab === 'applications' && <Applications />}
        {tab === 'removals' && <Removals />}
        {tab === 'reporters' && <Reporters />}
      </div>
    </>
  )
}

function useRows<T>(key: string, load: () => PromiseLike<{ data: unknown; error: { message: string } | null }>) {
  return useQuery({
    queryKey: ['moderation', key],
    queryFn: async () => {
      const { data, error } = await load()
      if (error) throw new Error(error.message)
      return data as T[]
    },
  })
}

/** 行ごとの操作。失敗したら関数が返した理由を出す */
function useAction(key: string) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (name: string, args: Record<string, unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await callRpc(name, args)
      await queryClient.invalidateQueries({ queryKey: ['moderation', key] })
    } catch (e) {
      setError(`${t.failed}：${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, run }
}

function List<T>({ q, children }: { q: { data?: T[]; isLoading: boolean; isError: boolean }; children: (row: T) => React.ReactNode }) {
  if (q.isLoading) return <p role="status" className="text-ink-soft">{ja.loading}</p>
  if (q.isError) return <p role="alert">{ja.loadError}</p>
  if (!q.data || q.data.length === 0) return <p>{t.empty}</p>
  return <ul className="m-0 list-none space-y-3 p-0">{q.data.map(children)}</ul>
}

function FacilityLink({ muniKey, facilityId, name }: { muniKey: string; facilityId: string; name: string }) {
  return (
    <Link to="/f/$muniKey/$facilityId" params={{ muniKey, facilityId }} target="_blank" className="font-bold">
      {name}
    </Link>
  )
}

interface ReportRow {
  id: string; facility_id: string; muni_key: string; facility_name: string; amenity_key: string
  value: AmenityJson; basis: Basis; source_url: string | null; photo_urls: string[] | null
  observed_at: string; note: string | null; created_at: string; reporter_tag: string
  current_value: AmenityJson | null; current_confidence: string | null
}
function Reports() {
  const q = useRows<ReportRow>('reports', () =>
    supabase!.from('reports_moderation').select('*').eq('status', 'pending').order('created_at').limit(100))
  return <List q={q}>{(r) => <ReportItem key={r.id} r={r} />}</List>
}
function ReportItem({ r }: { r: ReportRow }) {
  const a = useAction('reports')
  const [reason, setReason] = useState('')
  const def = amenityByKey.get(r.amenity_key)
  return (
    <li className="rounded border border-line bg-surface p-3 text-base">
      <FacilityLink muniKey={r.muni_key} facilityId={r.facility_id} name={r.facility_name} />
      <div className="mt-1">
        <strong>{def?.label_ja ?? r.amenity_key}</strong>
        <span className="mx-3">{t.proposed}：<strong>{formatValue(def, r.value)}</strong></span>
        {t.currentValue}：{r.current_value === null ? t.noCurrent : `${formatValue(def, r.current_value)}（${r.current_confidence}）`}
      </div>
      <div className="text-sm text-ink-soft">
        {jstDate(r.created_at)}・{ja.community.basis[r.basis]}・{ja.community.observedAt} {r.observed_at}・#{r.reporter_tag}
      </div>
      {r.note && <p className="m-0 mt-1">{r.note}</p>}
      {r.source_url && <p className="m-0 mt-1 break-all"><a href={r.source_url} target="_blank" rel="noopener noreferrer nofollow">{r.source_url}</a></p>}
      {r.photo_urls && (
        <ul className="m-0 mt-2 flex list-none flex-wrap gap-2 p-0">
          {r.photo_urls.map((u) => <li key={u}><a href={u} target="_blank" rel="noopener noreferrer"><img src={u} alt="" className="h-28 w-28 rounded border border-line object-cover" /></a></li>)}
        </ul>
      )}
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <button type="button" disabled={a.busy} className="rounded bg-ink px-3 py-1.5 font-bold text-white disabled:opacity-60"
          onClick={() => void a.run('review_report', { p_report_id: r.id, p_decision: 'accept' })}>{t.accept}</button>
        <label className="flex-1">
          <span className="block text-sm">{t.rejectReason}</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} className="w-full rounded border border-line bg-white px-2 py-1.5" />
        </label>
        <button type="button" disabled={a.busy} className="rounded border border-ink px-3 py-1.5 font-bold disabled:opacity-60"
          onClick={() => void a.run('review_report', { p_report_id: r.id, p_decision: 'reject', p_reason: reason })}>{t.reject}</button>
      </div>
      {a.error && <p role="alert" className="m-0 mt-1 font-bold">{a.error}</p>}
    </li>
  )
}

interface DisputeRow {
  id: string; facility_id: string; muni_key: string; facility_name: string; amenity_key: string
  reason: string; counter_value: AmenityJson | null; evidence_url: string | null; created_at: string
  raiser_tag: string; current_value: AmenityJson | null
}
function Disputes() {
  const q = useRows<DisputeRow>('disputes', () =>
    supabase!.from('disputes_moderation').select('*').eq('status', 'open').order('created_at').limit(100))
  return <List q={q}>{(d) => <DisputeItem key={d.id} d={d} />}</List>
}
function DisputeItem({ d }: { d: DisputeRow }) {
  const a = useAction('disputes')
  const [note, setNote] = useState('')
  const [withdraw, setWithdraw] = useState(false)
  const def = amenityByKey.get(d.amenity_key)
  const act = (decision: 'resolved' | 'dismissed') =>
    void a.run('resolve_dispute', { p_dispute_id: d.id, p_decision: decision, p_note: note, p_withdraw_value: decision === 'resolved' && withdraw })
  return (
    <li className="rounded border border-line bg-surface p-3 text-base">
      <FacilityLink muniKey={d.muni_key} facilityId={d.facility_id} name={d.facility_name} />
      <div className="mt-1"><strong>{def?.label_ja ?? d.amenity_key}</strong></div>
      <div className="mt-1 grid grid-cols-2 gap-2">
        <div className="rounded border border-line p-2">
          <div className="text-sm text-ink-soft">{ja.community.dispute.currentValue}</div>
          <strong>{formatValue(def, d.current_value)}</strong>
        </div>
        <div className="rounded border border-line p-2">
          <div className="text-sm text-ink-soft">{ja.community.dispute.counterValue}</div>
          <strong>{d.counter_value === null ? ja.community.dispute.noCounter : formatValue(def, d.counter_value)}</strong>
        </div>
      </div>
      <p className="m-0 mt-2">{d.reason}</p>
      {d.evidence_url && <p className="m-0 mt-1 break-all"><a href={d.evidence_url} target="_blank" rel="noopener noreferrer nofollow">{d.evidence_url}</a></p>}
      <div className="text-sm text-ink-soft">{jstDate(d.created_at)}・#{d.raiser_tag}</div>
      <label className="mt-2 block">
        <span className="block text-sm">{t.note}</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} className="w-full rounded border border-line bg-white px-2 py-1.5" />
      </label>
      <label className="mt-2 flex items-center gap-2">
        <input type="checkbox" checked={withdraw} onChange={(e) => setWithdraw(e.target.checked)} />{t.withdraw}
      </label>
      <div className="mt-2 flex gap-2">
        <button type="button" disabled={a.busy} className="rounded bg-ink px-3 py-1.5 font-bold text-white disabled:opacity-60" onClick={() => act('resolved')}>{t.resolve}</button>
        <button type="button" disabled={a.busy} className="rounded border border-ink px-3 py-1.5 font-bold disabled:opacity-60" onClick={() => act('dismissed')}>{t.dismiss}</button>
      </div>
      {a.error && <p role="alert" className="m-0 mt-1 font-bold">{a.error}</p>}
    </li>
  )
}

interface ApplicationRow { id: string; muni_key: string; organization: string; contact_email: string; note: string | null; created_at: string }
function Applications() {
  const q = useRows<ApplicationRow>('applications', () =>
    supabase!.from('facility_admin_applications').select('id, muni_key, organization, contact_email, note, created_at').eq('status', 'pending').order('created_at'))
  return <List q={q}>{(r) => <ApplicationItem key={r.id} r={r} />}</List>
}
function ApplicationItem({ r }: { r: ApplicationRow }) {
  const a = useAction('applications')
  const [note, setNote] = useState('')
  return (
    <li className="rounded border border-line bg-surface p-3 text-base">
      <strong>{r.organization}</strong>（{ja.community.admin.muni}：{r.muni_key}）
      <div>{r.contact_email}</div>
      {r.note && <p className="m-0 mt-1">{r.note}</p>}
      <div className="text-sm text-ink-soft">{jstDate(r.created_at)}</div>
      <label className="mt-2 block">
        <span className="block text-sm">{t.reviewNote}</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} className="w-full rounded border border-line bg-white px-2 py-1.5" />
      </label>
      <div className="mt-2 flex gap-2">
        <button type="button" disabled={a.busy} className="rounded bg-ink px-3 py-1.5 font-bold text-white disabled:opacity-60"
          onClick={() => void a.run('review_facility_admin_application', { p_id: r.id, p_approve: true, p_note: note })}>{t.approve}</button>
        <button type="button" disabled={a.busy} className="rounded border border-ink px-3 py-1.5 font-bold disabled:opacity-60"
          onClick={() => void a.run('review_facility_admin_application', { p_id: r.id, p_approve: false, p_note: note })}>{t.decline}</button>
      </div>
      {a.error && <p role="alert" className="m-0 mt-1 font-bold">{a.error}</p>}
    </li>
  )
}

interface RemovalRow { id: string; facility_id: string | null; requester_name: string; contact: string; relation: string; body: string; created_at: string }
function Removals() {
  const q = useRows<RemovalRow>('removals', () =>
    supabase!.from('removal_requests').select('id, facility_id, requester_name, contact, relation, body, created_at').eq('status', 'open').order('created_at'))
  return <List q={q}>{(r) => <RemovalItem key={r.id} r={r} />}</List>
}
function RemovalItem({ r }: { r: RemovalRow }) {
  const a = useAction('removals')
  const [note, setNote] = useState('')
  return (
    <li className="rounded border border-line bg-surface p-3 text-base">
      <strong>{r.requester_name}</strong>（{r.relation}）
      <div>{r.contact}</div>
      {r.facility_id && <div className="text-sm text-ink-soft">{ja.kind.sourceIdLabel}：{r.facility_id}</div>}
      <p className="m-0 mt-1 whitespace-pre-wrap">{r.body}</p>
      <div className="text-sm text-ink-soft">{jstDate(r.created_at)}</div>
      <label className="mt-2 block">
        <span className="block text-sm">{t.handlingNote}</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} className="w-full rounded border border-line bg-white px-2 py-1.5" />
      </label>
      <button type="button" disabled={a.busy} className="mt-2 rounded bg-ink px-3 py-1.5 font-bold text-white disabled:opacity-60"
        onClick={() => void a.run('close_removal_request', { p_id: r.id, p_note: note })}>{t.close}</button>
      {a.error && <p role="alert" className="m-0 mt-1 font-bold">{a.error}</p>}
    </li>
  )
}

interface ReporterRow { reporter_tag: string; total: number; rejected: number; reject_rate: number | null; flagged: boolean }
function Reporters() {
  const q = useRows<ReporterRow>('reporters', () => supabase!.rpc('moderation_reporter_stats'))
  if (q.isLoading) return <p role="status" className="text-ink-soft">{ja.loading}</p>
  if (q.isError) return <p role="alert">{ja.loadError}</p>
  if (!q.data || q.data.length === 0) return <p>{t.empty}</p>
  return (
    <table className="w-full border-collapse text-base">
      <thead>
        <tr className="border-b border-line text-left">
          <th className="py-1">{ja.community.history.reporter}</th><th>{t.processed}</th><th>{t.rejected}</th><th>{t.rate}</th><th></th>
        </tr>
      </thead>
      <tbody>
        {q.data.map((r) => (
          <tr key={r.reporter_tag} className="border-b border-line">
            <td className="py-1">#{r.reporter_tag}</td>
            <td className="tabular-nums">{r.total}</td>
            <td className="tabular-nums">{r.rejected}</td>
            <td className="tabular-nums">{r.reject_rate === null ? '—' : `${(Number(r.reject_rate) * 100).toFixed(0)}%`}</td>
            <td>{r.flagged && <strong>{t.flagged}</strong>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
