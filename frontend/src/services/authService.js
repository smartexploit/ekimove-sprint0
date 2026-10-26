const TOKEN_KEY = 'ekimove_access_token'
const USER_KEY = 'ekimove_user'

async function requestAuth(endpoint, payload) {
  let response

  try {
    response = await fetch(`/api/v1/auth/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch {
    throw new Error(
      'Unable to reach the EkiMove service. Check your connection and try again.',
    )
  }

  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    const detail = data.detail
    const message = typeof detail === 'string'
      ? detail
      : Array.isArray(detail)
        ? detail.map((item) => item.msg).join(', ')
        : 'Authentication failed. Please try again.'

    throw new Error(message)
  }

  return data
}

export async function apiRequest(path, options = {}) {
  const token = getAccessToken()
  const headers = { ...(options.headers || {}) }

  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json'
  }

  let response

  try {
    response = await fetch(path, { ...options, headers })
  } catch {
    throw new Error('Unable to reach EkiMove. Check that the API is running.')
  }

  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    if (response.status === 401) {
      logoutPassenger()
    }

    const detail = data.detail
    const message = typeof detail === 'string'
      ? detail
      : Array.isArray(detail)
        ? detail.map((item) => item.msg).join(', ')
        : `Request failed (${response.status}). Please try again.`

    throw new Error(message)
  }

  return data
}

export async function getCurrentUser() {
  const token = getAccessToken()

  if (!token) {
    throw new Error('Please sign in to continue.')
  }

  const user = await apiRequest('/api/v1/auth/me')
  sessionStorage.setItem(USER_KEY, JSON.stringify(user))
  return user
}

export async function getPaymentPolicy() {
  return apiRequest('/api/v1/policy/payments')
}

export async function registerPassenger({ phone, full_name, password }) {
  const data = await requestAuth('register', {
    phone: phone.trim(),
    full_name: full_name.trim(),
    password,
  })

  saveSession(data.access_token, data.user)
  return data
}

export async function loginPassenger({ phone, password }) {
  const data = await requestAuth('login', {
    phone: phone.trim(),
    password,
  })

  saveSession(data.access_token)
  return data
}

function saveSession(token, user) {
  if (!token) {
    throw new Error('The server did not return an access token.')
  }

  sessionStorage.setItem(TOKEN_KEY, token)

  if (user) {
    sessionStorage.setItem(USER_KEY, JSON.stringify(user))
  } else {
    sessionStorage.removeItem(USER_KEY)
  }
}

export function getAccessToken() {
  return sessionStorage.getItem(TOKEN_KEY)
}

export function getStoredUser() {
  const value = sessionStorage.getItem(USER_KEY)

  try {
    return value ? JSON.parse(value) : null
  } catch {
    return null
  }
}

export function logoutPassenger() {
  sessionStorage.removeItem(TOKEN_KEY)
  sessionStorage.removeItem(USER_KEY)
}
