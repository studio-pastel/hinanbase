import type { Session } from '@supabase/supabase-js'
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { signInRedirectUrl } from './authUrl.ts'
import { initialAuthError, supabase } from './supabase.ts'

export type AppRole = 'user' | 'facility_admin' | 'moderator' | 'admin'

interface AuthState {
  /** 投稿機能が使える構成か */
  available: boolean
  loading: boolean
  session: Session | null
  role: AppRole
  isModerator: boolean
  /** ログインから戻ってきたときに認証側が返したエラー（あれば） */
  error: string | null
  signIn: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(supabase !== null)
  const error = initialAuthError

  useEffect(() => {
    if (!supabase) return
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => data.subscription.unsubscribe()
  }, [])

  const value = useMemo<AuthState>(() => {
    // 役割は app_metadata.role（利用者自身は書き換えられない）。画面の出し分け用で、権限の判定はサーバー側で行う
    const role = ((session?.user.app_metadata as { role?: AppRole } | undefined)?.role ?? 'user') as AppRole
    return {
      available: supabase !== null,
      loading,
      session,
      role,
      isModerator: role === 'moderator' || role === 'admin',
      error,
      signIn: async () => {
        // 開始時は Google ログインのみ（SPEC §4.2）
        const { error } = await supabase!.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: signInRedirectUrl() },
        })
        if (error) throw error
      },
      signOut: async () => {
        await supabase!.auth.signOut()
      },
    }
  }, [session, loading, error])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('AuthProvider の外で useAuth が呼ばれました')
  return ctx
}
