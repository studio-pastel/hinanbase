import { Link, Outlet } from '@tanstack/react-router'
import { ja } from '../i18n/ja.ts'
import { useMeta } from '../lib/data.ts'

export function Layout() {
  const meta = useMeta()
  return (
    <div className="flex min-h-full flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:bg-white focus:px-3 focus:py-2">
        {ja.skipToMain}
      </a>
      {/* 全ページ最上部の固定バナー（SPEC §6.6、CLAUDE.md 絶対ルール 7） */}
      <div role="note" className="sticky top-0 z-40 bg-ink px-4 py-2 text-center text-[13px] leading-snug text-white">
        {ja.banner}
      </div>
      <header className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-line bg-surface px-4 py-2">
        <Link to="/" className="flex items-baseline gap-3 text-ink no-underline">
          <span className="text-lg font-bold tracking-wide">{ja.appName}</span>
          <span className="hidden text-sm text-ink-soft sm:inline">{ja.tagline}</span>
        </Link>
        <nav aria-label={ja.nav.label} className="ml-auto flex gap-1 text-sm">
          <NavLink to="/">{ja.nav.map}</NavLink>
          <NavLink to="/list">{ja.nav.list}</NavLink>
        </nav>
      </header>
      <main id="main" className="flex min-h-0 flex-1 flex-col">
        <Outlet />
      </main>
      <footer className="border-t border-line bg-surface px-4 py-2 text-xs leading-relaxed text-ink-soft">
        <p className="m-0">
          {ja.footer.source}
          {meta.data && `（${ja.footer.fetched}：${meta.data.d1_fetched_date}）`}
          {ja.facility.cityNote}
        </p>
        <p className="m-0">{ja.footer.license}</p>
      </footer>
    </div>
  )
}

function NavLink({ to, children }: { to: '/' | '/list'; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      activeOptions={{ exact: to === '/' }}
      className="rounded px-3 py-1.5 text-ink no-underline hover:bg-paper"
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
