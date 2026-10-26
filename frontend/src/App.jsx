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
import ProtectedRoute from './routes/ProtectedRoute.jsx'
import AdminDriverVerificationPage from './pages/admin/AdminDriverVerificationPage.jsx'
import AdminPaymentsPage from './pages/admin/AdminPaymentsPage.jsx'
import AdminIncidentsPage from './pages/admin/AdminIncidentsPage.jsx'

export default function App() {
  return (
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
</Route>

<Route element={<ProtectedRoute requiredRole="super_admin" />}>
  <Route path="/admin/dispatch" element={<AdminDispatchPage />} />
  <Route path="/admin/payments" element={<AdminPaymentsPage />} />
  <Route path="/admin/incidents" element={<AdminIncidentsPage />} />
  <Route
    path="/admin/drivers"
    element={<AdminDriverVerificationPage />}
  />
</Route>

      <Route element={<ProtectedRoute requiredRole="driver" />}>
        <Route path="/driver/status" element={<DriverStatusPage />} />
        <Route path="/driver/trips" element={<DriverTripsPage />} />
      </Route>
      <Route path="/profile" element={<Navigate to="/dashboard" replace />} />
      <Route path="/driver" element={<Navigate to="/driver/apply" replace />} />
      <Route path="/admin" element={<Navigate to="/admin/dispatch" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
