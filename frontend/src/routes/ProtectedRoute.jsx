import { useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { LogoMark } from '../components/brand/Logo.jsx'
import { getCurrentUser, getAccessToken, logoutPassenger } from '../services/authService.js'
import { homePathForRole } from '../utils/roles.js'
import SessionTimeout from '../components/SessionTimeout.jsx'

export default function ProtectedRoute({ requiredRole = 'passenger' }) {
  const location = useLocation()
  const [state, setState] = useState({
    loading: true,
    user: null,
  })

  useEffect(() => {
    let active = true

    async function verifySession() {
      if (!getAccessToken()) {
        if (active) setState({ loading: false, user: null })
        return
      }

      try {
        const user = await getCurrentUser()
        if (active) setState({ loading: false, user })
      } catch {
        logoutPassenger()
        if (active) setState({ loading: false, user: null })
      }
    }

    verifySession()

    return () => {
      active = false
    }
  }, [])

  if (state.loading) {
    return (
      <main className="loading-screen" aria-live="polite">
        <LogoMark size={56} />
        <span className="spinner" aria-hidden="true" />
        <p>Checking your EkiMove session…</p>
      </main>
    )
  }

  if (!state.user) {
    // Keep the query string so a trip planned before signing in survives.
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    )
  }

  if (!state.user.is_active) {
    logoutPassenger()
    return <Navigate to="/login" replace />
  }

  const allowed = Array.isArray(requiredRole) ? requiredRole : [requiredRole]
  if (!allowed.includes(state.user.role)) {
    // Send known roles to their own area; anything else goes to the
    // public homepage so an unexpected role can never loop.
    const knownRole = ['passenger', 'driver', 'super_admin'].includes(state.user.role)
    return <Navigate to={knownRole ? homePathForRole(state.user.role) : '/'} replace />
  }

  return (
    <>
      <SessionTimeout />
      <Outlet context={{ user: state.user }} />
    </>
  )
}
