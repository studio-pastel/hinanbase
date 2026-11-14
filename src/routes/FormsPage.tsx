// 削除・訂正の要請フォームと、施設管理者アカウントの申請フォーム（SPEC §4.5）
import { useState } from 'react'
import { RequireSignIn } from '../components/SignIn.tsx'
import { ja } from '../i18n/ja.ts'
import { callRpc } from '../lib/community.ts'
import { supabase } from '../lib/supabase.ts'

const inputClass = 'w-full rounded border border-line bg-white px-2 py-1.5'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-base font-bold">{label}</span>
      {children}
    </label>
  )
}

function useSubmit() {
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)
  const send = async (name: string, args: Record<string, unknown>) => {
    setState('sending')
    setError(null)
    try {
      await callRpc(name, args)
      setState('done')
    } catch (e) {
      setError(`${ja.community.error}：${(e as Error).message}`)
      setState('idle')
    }
  }
  return { state, error, send }
}

export function RemovalRequestPage() {
  const t = ja.community.removal
  const s = useSubmit()
  const initialFacility = new URLSearchParams(window.location.search).get('facility') ?? ''
  const [f, setF] = useState({ name: '', contact: '', relation: '', facility: initialFacility, body: '' })
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value })
  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-5">
      <h1 className="m-0 text-2xl font-bold">{t.title}</h1>
      <p className="m-0 text-base text-ink-soft">{t.intro}</p>
      {!supabase ? (
        <p role="alert">{ja.auth.unavailable}</p>
      ) : s.state === 'done' ? (
        <p role="status" className="rounded border border-line bg-surface p-4">{t.done}</p>
      ) : (
        <form className="space-y-3 rounded border border-line bg-surface p-4" onSubmit={(e) => {
          e.preventDefault()
          void s.send('submit_removal_request', {
            p_requester_name: f.name, p_contact: f.contact, p_relation: f.relation, p_body: f.body, p_facility_id: f.facility || null,
          })
        }}>
          <Field label={t.name}><input required maxLength={200} value={f.name} onChange={set('name')} autoComplete="name" className={inputClass} /></Field>
          <Field label={t.contact}><input required maxLength={320} value={f.contact} onChange={set('contact')} autoComplete="email" className={inputClass} /></Field>
          <Field label={t.relation}><input required maxLength={200} value={f.relation} onChange={set('relation')} className={inputClass} /></Field>
          <Field label={t.facilityId}><input maxLength={40} value={f.facility} onChange={set('facility')} className={inputClass} /></Field>
          <Field label={t.body}><textarea required minLength={10} maxLength={4000} rows={6} value={f.body} onChange={set('body')} className={inputClass} /></Field>
          {s.error && <p role="alert" className="m-0 text-base font-bold">{s.error}</p>}
          <button type="submit" disabled={s.state === 'sending'} className="rounded bg-ink px-4 py-2 font-bold text-white disabled:opacity-60">{t.submit}</button>
        </form>
      )}
    </div>
  )
}

export function FacilityAdminApplyPage() {
  const t = ja.community.admin
  const s = useSubmit()
  const [f, setF] = useState({ muni: '', organization: '', email: '', note: '' })
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value })
  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-5">
      <h1 className="m-0 text-2xl font-bold">{t.title}</h1>
      <p className="m-0 text-base text-ink-soft">{t.intro}</p>
      <RequireSignIn>
        {s.state === 'done' ? (
          <p role="status" className="rounded border border-line bg-surface p-4">{t.done}</p>
        ) : (
          <form className="space-y-3 rounded border border-line bg-surface p-4" onSubmit={(e) => {
            e.preventDefault()
            void s.send('apply_facility_admin', {
              p_muni_key: f.muni, p_organization: f.organization, p_contact_email: f.email, p_note: f.note || null,
            })
          }}>
            <Field label={t.muni}><input required pattern="[0-9]{5}" inputMode="numeric" value={f.muni} onChange={set('muni')} className={inputClass} /></Field>
            <Field label={t.organization}><input required maxLength={200} value={f.organization} onChange={set('organization')} autoComplete="organization" className={inputClass} /></Field>
            <Field label={t.email}><input required type="email" maxLength={320} value={f.email} onChange={set('email')} autoComplete="email" className={inputClass} /></Field>
            <Field label={t.note}><textarea maxLength={1000} rows={3} value={f.note} onChange={set('note')} className={inputClass} /></Field>
            {s.error && <p role="alert" className="m-0 text-base font-bold">{s.error}</p>}
            <button type="submit" disabled={s.state === 'sending'} className="rounded bg-ink px-4 py-2 font-bold text-white disabled:opacity-60">{t.submit}</button>
          </form>
        )}
      </RequireSignIn>
    </div>
  )
}
