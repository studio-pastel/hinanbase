import { createRootRoute, createRoute, createRouter, Link } from '@tanstack/react-router'
import { Layout } from './components/Layout.tsx'
import { ja } from './i18n/ja.ts'
import { FacilityPage } from './routes/FacilityPage.tsx'
import { FacilityAdminApplyPage, RemovalRequestPage } from './routes/FormsPage.tsx'
import { ListFacilitiesPage, ListMunisPage, ListPrefsPage } from './routes/ListPage.tsx'
import { MapPage } from './routes/MapPage.tsx'
import { NearPage } from './routes/NearPage.tsx'
import { ModerationPage } from './routes/ModerationPage.tsx'
import { ReportPage } from './routes/ReportPage.tsx'

const rootRoute = createRootRoute({
  component: Layout,
  notFoundComponent: () => (
    <div className="p-4">
      <p role="alert">{ja.notFound}</p>
      <p><Link to="/">{ja.backToMap}</Link></p>
    </div>
  ),
})
const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: '/', component: MapPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/f/$muniKey/$facilityId', component: FacilityPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/f/$muniKey/$facilityId/report', component: ReportPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/moderation', component: ModerationPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/removal-request', component: RemovalRequestPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/facility-admin', component: FacilityAdminApplyPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/near', component: NearPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/list', component: ListPrefsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/list/$prefCode', component: ListMunisPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/list/$prefCode/$muniKey', component: ListFacilitiesPage }),
])

export const router = createRouter({ routeTree, defaultPreload: 'intent' })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
