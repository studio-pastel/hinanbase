import { Link, Outlet } from '@tanstack/react-router'
import { ja } from '../i18n/ja.ts'
import { useAuth } from '../lib/auth.tsx'
import { useMeta } from '../lib/data.ts'

export function Layout() {
  const meta = useMeta()
  const auth = useAuth()
  return (
    <div className="flex min-h-full flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:bg-white focus:px-3 focus:py-2">
        {ja.skipToMain}
      </a>
      {/* 全ページ最上部の固定バナー（SPEC §6.6、CLAUDE.md 絶対ルール 7） */}
      <div role="note" className="sticky top-0 z-40 bg-ink px-3 py-1.5 text-center text-sm leading-snug text-white">
        {ja.banner}
      </div>
      <header className="flex items-center gap-x-1 overflow-x-auto border-b border-line bg-surface px-3 py-1.5 sm:gap-x-6 sm:px-4">
        <Link to="/" className="flex shrink-0 items-baseline gap-3 whitespace-nowrap text-ink no-underline">
          <span className="text-lg font-bold tracking-wide sm:text-xl">{ja.appName}</span>
          <span className="hidden text-base text-ink-soft md:inline">{ja.tagline}</span>
        </Link>
        <nav aria-label={ja.nav.label} className="ml-auto flex shrink-0 text-base sm:gap-1">
          <NavLink to="/">{ja.nav.map}</NavLink>
          <NavLink to="/list">{ja.nav.list}</NavLink>
          {auth.isModerator && <NavLink to="/moderation">{ja.auth.moderation}</NavLink>}
        </nav>
        {auth.available && !auth.loading && (
          auth.session ? (
            <button type="button" onClick={() => void auth.signOut()} className="shrink-0 whitespace-nowrap rounded border border-line px-2 text-base sm:px-3">
              {ja.auth.signOut}
            </button>
          ) : (
            <button type="button" onClick={() => void auth.signIn().catch(() => undefined)} className="shrink-0 whitespace-nowrap rounded border border-line px-2 text-base sm:px-3">
              {ja.auth.signIn}
            </button>
          )
        )}
      </header>
      {auth.error && (
        <p role="alert" className="m-0 border-b border-line bg-surface px-4 py-2 text-base">
          {ja.auth.failed}（{auth.error}）
        </p>
      )}
      <main id="main" className="flex min-h-0 flex-1 flex-col">
        <Outlet />
      </main>
      <footer className="border-t border-line bg-surface px-4 py-3 text-sm leading-relaxed text-ink-soft">
        <p className="m-0">
          {ja.footer.source}
          {meta.data && `（${ja.footer.fetched}：${meta.data.d1_fetched_date}）`}
          {ja.facility.cityNote}
        </p>
        <p className="m-0">{ja.footer.license}</p>
        {auth.available && (
          <ul className="m-0 mt-1 flex list-none flex-col p-0 sm:flex-row sm:gap-6">
            <li><Link to="/removal-request" className="inline-flex min-h-11 items-center">{ja.community.removal.link}</Link></li>
            <li><Link to="/facility-admin" className="inline-flex min-h-11 items-center">{ja.community.admin.link}</Link></li>
          </ul>
        )}
      </footer>
    </div>
  )
}

function NavLink({ to, children }: { to: '/' | '/list' | '/moderation'; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      activeOptions={{ exact: to === '/' }}
      className="flex min-h-11 items-center whitespace-nowrap rounded px-2 text-ink no-underline hover:bg-paper sm:px-3"
      activeProps={{ className: 'bg-paper font-bold', 'aria-current': 'page' }}
    >
      {children}
    </Link>
  )
}

export function Status({ loading, error }: { loading: boolean; error: boolean }) {
  if (error) return <p role="alert" className="p-4">{ja.loadError}</p>
  if (loading) return <p role="status" className="p-4 text-ink-soft">{ja.loading}</p>
  return null
}
