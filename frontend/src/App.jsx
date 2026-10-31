import { Navigate, Route, Routes } from 'react-router-dom'
import HomePage from './pages/public/HomePage.jsx'
import LoginPage from './pages/auth/LoginPage.jsx'
import RegisterPage from './pages/auth/RegisterPage.jsx'
import DashboardPage from './pages/passenger/DashboardPage.jsx'
import BookRidePage from './pages/passenger/BookRidePage.jsx'
import MyRidesPage from './pages/passenger/MyRidesPage.jsx'
import PaymentsPage from './pages/passenger/PaymentsPage.jsx'
import AdminDispatchPage from './pages/admin/AdminDispatchPage.jsx'
import DriverApplicationPage from './pages/driver/DriverApplicationPage.jsx'
import DriverStatusPage from './pages/driver/DriverStatusPage.jsx'
import DriverTripsPage from './pages/driver/DriverTripsPage.jsx'
import DriverEarningsPage from './pages/driver/DriverEarningsPage.jsx'
import ProtectedRoute from './routes/ProtectedRoute.jsx'
import OfflineBanner from './components/pwa/OfflineBanner.jsx'
import AdminDriverVerificationPage from './pages/admin/AdminDriverVerificationPage.jsx'
import AdminPaymentsPage from './pages/admin/AdminPaymentsPage.jsx'
import AdminOverviewPage from './pages/admin/AdminOverviewPage.jsx'
import AdminPeoplePage from './pages/admin/AdminPeoplePage.jsx'
import AdminSupportPage from './pages/admin/AdminSupportPage.jsx'
import AdminLoadsPage from './pages/admin/AdminLoadsPage.jsx'
import HaulagePage from './pages/passenger/HaulagePage.jsx'
import ProfilePage from './pages/account/ProfilePage.jsx'
import SupportPage from './pages/account/SupportPage.jsx'
import AdminEarningsPage from './pages/admin/AdminEarningsPage.jsx'
import AdminIncidentsPage from './pages/admin/AdminIncidentsPage.jsx'

import AdminLocationsPage from './pages/admin/AdminLocationsPage.jsx'

export default function App() {
  return (
    <>
      <OfflineBanner />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/driver/apply" element={<DriverApplicationPage />} />

        <Route element={<ProtectedRoute />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/book-ride" element={<BookRidePage />} />
          <Route path="/my-rides" element={<MyRidesPage />} />
          <Route path="/payments" element={<PaymentsPage />} />
          <Route path="/move-a-load" element={<HaulagePage />} />
        </Route>

        <Route element={<ProtectedRoute requiredRole="super_admin" />}>
          <Route path="/admin/dispatch" element={<AdminDispatchPage />} />
          <Route path="/admin/overview" element={<AdminOverviewPage />} />
          <Route path="/admin/people" element={<AdminPeoplePage />} />
          <Route path="/admin/support" element={<AdminSupportPage />} />
          <Route path="/admin/loads" element={<AdminLoadsPage />} />
          <Route path="/admin/payments" element={<AdminPaymentsPage />} />
          <Route path="/admin/earnings" element={<AdminEarningsPage />} />
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
        </Route>
        <Route path="/driver" element={<Navigate to="/driver/apply" replace />} />
        <Route path="/admin" element={<Navigate to="/admin/overview" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}

