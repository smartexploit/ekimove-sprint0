import { useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { getCurrentUser, getAccessToken, logoutPassenger } from '../services/authService.js'

export default function ProtectedRoute({ requiredRole = 'passenger' }) {
  const location = useLocation()
  const [state, setState] = useState({
    loading: true,
    user: null,
    error: '',
  })

  useEffect(() => {
    let active = true

    async function verifySession() {
      if (!getAccessToken()) {
        if (active) {
          setState({ loading: false, user: null, error: '' })
        }
        return
      }

      try {
        const user = await getCurrentUser()
        if (active) {
          setState({ loading: false, user, error: '' })
        }
      } catch {
        logoutPassenger()
        if (active) {
          setState({ loading: false, user: null, error: '' })
        }
      }
    }

    verifySession()

    return () => {
      active = false
    }
  }, [])

  if (state.loading) {
    return (
      <main className="portal-loading" aria-live="polite">
        <span className="portal-spinner" />
        <p>Verifying your EkiMove session…</p>
      </main>
    )
  }

  if (!state.user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  if (!state.user.is_active) {
    logoutPassenger()
    return <Navigate to="/login" replace />
  }

  if (state.user.role !== requiredRole) {
    return (
      <Navigate
        to={requiredRole === 'super_admin' ? '/dashboard' : requiredRole === 'driver' ? '/dashboard' : '/'}
        replace
      />
    )
  }

  return <Outlet context={{ user: state.user }} />
}
