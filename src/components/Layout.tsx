import { Link, Outlet } from '@tanstack/react-router'
import { ja } from '../i18n/ja.ts'
import { useAuth } from '../lib/auth.tsx'
import { useMeta } from '../lib/data.ts'

export function Layout() {
  const meta = useMeta()
  const auth = useAuth()
  return (
    <div className="flex min-h-full flex-col pb-[calc(3.75rem+env(safe-area-inset-bottom))] sm:pb-0">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:bg-white focus:px-3 focus:py-2">
        {ja.skipToMain}
      </a>
      {/* 全ページ最上部の固定バナー（SPEC §6.6、CLAUDE.md 絶対ルール 7） */}
      <div role="note" className="sticky top-0 z-40 bg-ink px-3 py-1.5 text-center text-sm leading-snug text-white">
        {ja.banner}
      </div>
      <header className="flex items-center gap-x-1 overflow-x-auto border-b border-line bg-surface px-2 py-1.5 sm:gap-x-6 sm:px-4">
        <Link to="/" className="flex shrink-0 items-baseline gap-3 whitespace-nowrap text-ink no-underline">
          <span className="text-base font-bold tracking-wide min-[400px]:text-lg sm:text-xl">{ja.appName}</span>
          <span className="hidden text-base text-ink-soft md:inline">{ja.tagline}</span>
        </Link>
        <nav aria-label={ja.nav.label} className="ml-auto hidden shrink-0 text-base sm:flex sm:gap-1">
          <NavLink to="/">{ja.nav.map}</NavLink>
          <NavLink to="/list">{ja.nav.list}</NavLink>
          {/* スマホでは短い文言にして、ヘッダーを 1 行に収める */}
          <NavLink to="/near" label={ja.nav.near}>
            <span className="sm:hidden">{ja.nav.nearShort}</span>
            <span className="hidden sm:inline">{ja.nav.near}</span>
          </NavLink>
          {auth.isModerator && <NavLink to="/moderation">{ja.auth.moderation}</NavLink>}
        </nav>
        {auth.available && !auth.loading && (
          auth.session ? (
            <button type="button" onClick={() => void auth.signOut()} className="ml-auto shrink-0 sm:ml-0 whitespace-nowrap rounded border border-line px-1.5 text-base sm:px-3">
              {ja.auth.signOut}
            </button>
          ) : (
            <button type="button" onClick={() => void auth.signIn().catch(() => undefined)} className="ml-auto shrink-0 sm:ml-0 whitespace-nowrap rounded border border-line px-1.5 text-base sm:px-3">
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
      {/* スマホ：アプリのような下部メニュー。PC では上のナビを使う */}
      <nav aria-label={ja.nav.bottomLabel} className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] shadow-[0_-2px_8px_rgba(0,0,0,0.08)] sm:hidden">
        <BottomLink to="/" icon={<IconMap />}>{ja.nav.map}</BottomLink>
        <BottomLink to="/near" icon={<IconPin />}>{ja.nav.nearBottom}</BottomLink>
        <BottomLink to="/list" icon={<IconList />}>{ja.nav.listShort}</BottomLink>
        {auth.isModerator && <BottomLink to="/moderation" icon={<IconList />}>{ja.auth.moderation}</BottomLink>}
      </nav>
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

function NavLink({ to, label, children }: { to: '/' | '/list' | '/near' | '/moderation'; label?: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      activeOptions={{ exact: to === '/' }}
      aria-label={label}
      className="flex min-h-11 items-center whitespace-nowrap rounded px-1.5 text-ink no-underline hover:bg-paper sm:px-3"
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

function BottomLink({ to, icon, children }: { to: '/' | '/list' | '/near' | '/moderation'; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      activeOptions={{ exact: to === '/' }}
      className="flex min-h-[3.75rem] flex-1 flex-col items-center justify-center gap-0.5 text-xs text-ink-soft no-underline"
      activeProps={{ className: 'font-bold !text-ink', 'aria-current': 'page' }}
    >
      {icon}
      <span>{children}</span>
    </Link>
  )
}

const iconProps = { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
const IconMap = () => <svg {...iconProps}><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z" /><path d="M9 4v14M15 6v14" /></svg>
const IconPin = () => <svg {...iconProps}><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11Z" /><circle cx="12" cy="10" r="2.5" /></svg>
const IconList = () => <svg {...iconProps}><path d="M8 6h13M8 12h13M8 18h13" /><circle cx="3.5" cy="6" r="1" /><circle cx="3.5" cy="12" r="1" /><circle cx="3.5" cy="18" r="1" /></svg>
