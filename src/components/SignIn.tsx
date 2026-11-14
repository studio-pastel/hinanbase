import { useState } from 'react'
import { ja } from '../i18n/ja.ts'
import { useAuth } from '../lib/auth.tsx'

export function SignInButton({ className }: { className?: string }) {
  const { signIn } = useAuth()
  const [failed, setFailed] = useState(false)
  return (
    <span>
      <button
        type="button"
        className={className ?? 'rounded border border-ink bg-ink px-4 py-2 text-base font-bold text-white'}
        onClick={() => { setFailed(false); signIn().catch(() => setFailed(true)) }}
      >
        {ja.auth.signInGoogle}
      </button>
      {failed && <span role="alert" className="ml-2 text-base">{ja.auth.failed}</span>}
    </span>
  )
}

/** ログインが必要な画面の入口。投稿機能が無効な構成・未ログインのときに案内を出す */
export function RequireSignIn({ children }: { children: React.ReactNode }) {
  const auth = useAuth()
  if (!auth.available) return <p role="alert">{ja.auth.unavailable}</p>
  if (auth.loading) return <p role="status" className="text-ink-soft">{ja.loading}</p>
  if (!auth.session) {
    return (
      <div className="rounded border border-line bg-surface p-4">
        <p className="m-0 mb-3">{ja.auth.required}</p>
        <SignInButton />
      </div>
    )
  }
  return <>{children}</>
}
