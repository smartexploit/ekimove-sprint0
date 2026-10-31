import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import HomePage from './pages/public/HomePage.jsx'
import LoginPage from './pages/auth/LoginPage.jsx'
import RegisterPage from './pages/auth/RegisterPage.jsx'
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage.jsx'
import DashboardPage from './pages/passenger/DashboardPage.jsx'
import BookRidePage from './pages/passenger/BookRidePage.jsx'
import MyRidesPage from './pages/passenger/MyRidesPage.jsx'
import PaymentsPage from './pages/passenger/PaymentsPage.jsx'
import DriverApplicationPage from './pages/driver/DriverApplicationPage.jsx'
import DriverStatusPage from './pages/driver/DriverStatusPage.jsx'
import DriverTripsPage from './pages/driver/DriverTripsPage.jsx'
import DriverEarningsPage from './pages/driver/DriverEarningsPage.jsx'
import ProtectedRoute from './routes/ProtectedRoute.jsx'
import OfflineBanner from './components/pwa/OfflineBanner.jsx'
import HaulagePage from './pages/passenger/HaulagePage.jsx'
import InvitePage from './pages/passenger/InvitePage.jsx'
import ProfilePage from './pages/account/ProfilePage.jsx'
import SupportPage from './pages/account/SupportPage.jsx'
import ReceiptPage from './pages/account/ReceiptPage.jsx'
import TrackSharePage from './pages/public/TrackSharePage.jsx'
import PoliciesPage from './pages/public/PoliciesPage.jsx'


// Admin screens load only for super-admins, keeping the passenger app small.
const AdminDispatchPage = lazy(() => import('./pages/admin/AdminDispatchPage.jsx'))
const AdminDriverVerificationPage = lazy(() => import('./pages/admin/AdminDriverVerificationPage.jsx'))
const AdminPaymentsPage = lazy(() => import('./pages/admin/AdminPaymentsPage.jsx'))
const AdminOverviewPage = lazy(() => import('./pages/admin/AdminOverviewPage.jsx'))
const AdminPeoplePage = lazy(() => import('./pages/admin/AdminPeoplePage.jsx'))
const AdminSupportPage = lazy(() => import('./pages/admin/AdminSupportPage.jsx'))
const AdminLoadsPage = lazy(() => import('./pages/admin/AdminLoadsPage.jsx'))
const AdminMapPage = lazy(() => import('./pages/admin/AdminMapPage.jsx'))
const AdminEarningsPage = lazy(() => import('./pages/admin/AdminEarningsPage.jsx'))
const AdminIncidentsPage = lazy(() => import('./pages/admin/AdminIncidentsPage.jsx'))
const AdminReportsPage = lazy(() => import('./pages/admin/AdminReportsPage.jsx'))
const AdminPromosPage = lazy(() => import('./pages/admin/AdminPromosPage.jsx'))
const AdminLocationsPage = lazy(() => import('./pages/admin/AdminLocationsPage.jsx'))

const loading = (
  <main className="loading-screen" aria-live="polite">
    <span className="spinner" aria-hidden="true" />
  </main>
)

export default function App() {
  return (
    <>
      <OfflineBanner />
      <Suspense fallback={loading}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/driver/apply" element={<DriverApplicationPage />} />
        <Route path="/t/:token" element={<TrackSharePage />} />
        <Route path="/policies" element={<PoliciesPage />} />
        <Route path="/policies/:slug" element={<PoliciesPage />} />

        <Route element={<ProtectedRoute />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/book-ride" element={<BookRidePage />} />
          <Route path="/my-rides" element={<MyRidesPage />} />
          <Route path="/payments" element={<PaymentsPage />} />
          <Route path="/move-a-load" element={<HaulagePage />} />
          <Route path="/invite" element={<InvitePage />} />
        </Route>

        <Route element={<ProtectedRoute requiredRole="super_admin" />}>
          <Route path="/admin/dispatch" element={<AdminDispatchPage />} />
          <Route path="/admin/overview" element={<AdminOverviewPage />} />
          <Route path="/admin/map" element={<AdminMapPage />} />
          <Route path="/admin/people" element={<AdminPeoplePage />} />
          <Route path="/admin/support" element={<AdminSupportPage />} />
          <Route path="/admin/loads" element={<AdminLoadsPage />} />
          <Route path="/admin/payments" element={<AdminPaymentsPage />} />
          <Route path="/admin/earnings" element={<AdminEarningsPage />} />
          <Route path="/admin/reports" element={<AdminReportsPage />} />
          <Route path="/admin/promos" element={<AdminPromosPage />} />
          <Route path="/admin/incidents" element={<AdminIncidentsPage />} />
          <Route path="/admin/locations" element={<AdminLocationsPage />} />
          <Route path="/admin/drivers" element={<AdminDriverVerificationPage />} />
        </Route>

        <Route element={<ProtectedRoute requiredRole="driver" />}>
          <Route path="/driver/status" element={<DriverStatusPage />} />
          <Route path="/driver/trips" element={<DriverTripsPage />} />
          <Route path="/driver/earnings" element={<DriverEarningsPage />} />
        </Route>
        <Route element={<ProtectedRoute requiredRole={['passenger', 'driver']} />}>
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/support" element={<SupportPage />} />
          <Route path="/receipts/:rideId" element={<ReceiptPage />} />
        </Route>
        <Route path="/driver" element={<Navigate to="/driver/apply" replace />} />
        <Route path="/admin" element={<Navigate to="/admin/overview" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </>
  )
}

