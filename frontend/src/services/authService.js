const TOKEN_KEY = 'ekimove_access_token'
const USER_KEY = 'ekimove_user'
const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || ''
).replace(/\/+$/, '')

export function apiUrl(path) {
  if (/^https?:\/\//i.test(path)) return path
  return `${API_BASE_URL}/${path.replace(/^\/+/, '')}`
}

async function requestAuth(endpoint, payload) {
  let response

  try {
    response = await fetch(apiUrl(`/api/v1/auth/${endpoint}`), {
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

  // Let the browser set the multipart boundary for file uploads.
  if (options.body && !(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json'
  }

  let response

  try {
    response = await fetch(apiUrl(path), { ...options, headers })
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
        : detail?.message || `Request failed (${response.status}). Please try again.`

    const error = new Error(message)
    error.status = response.status
    error.code = detail?.code
    throw error
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

export async function registerPassenger({ phone = '', email = '', full_name, password, accept_policies = false, referral_code = '' }) {
  const data = await requestAuth('register', {
    ...(referral_code.trim() ? { referral_code: referral_code.trim() } : {}),
    ...(phone.trim() ? { phone: phone.trim() } : {}),
    ...(email.trim() ? { email: email.trim() } : {}),
    full_name: full_name.trim(),
    password,
    accept_policies,
  })

  saveSession(data.access_token, data.user)
  return data
}

/** Sign in with a phone number or an email address. */
export async function loginPassenger({ identifier, phone, password, remember = false }) {
  const data = await requestAuth('login', {
    identifier: (identifier ?? phone ?? '').trim(),
    password,
    remember,
  })

  saveSession(data.access_token)
  if (data.device_token) saveDevice({ token: data.device_token })
  else if (remember === false) clearDevice()
  return data
}

// ---------- Keep me signed in (remembered phone) ----------
const DEVICE_KEY = 'ekimove.device'

/** The remembered phone: { token, first_name, role, account, has_pin }. */
export function getDevice() {
  try {
    const value = JSON.parse(localStorage.getItem(DEVICE_KEY) || 'null')
    return value?.token ? value : null
  } catch {
    return null
  }
}

export function saveDevice(details) {
  try {
    localStorage.setItem(DEVICE_KEY, JSON.stringify({ ...(getDevice() || {}), ...details }))
  } catch {
    /* private mode: the person signs in normally next time */
  }
}

export function clearDevice() {
  try {
    localStorage.removeItem(DEVICE_KEY)
  } catch {
    /* nothing to clear */
  }
}

/** Where to send someone whose session ended: unlock if this phone is remembered. */
export function signInPath() {
  return getDevice() ? '/unlock' : '/login'
}

export async function describeDevice() {
  const device = getDevice()
  if (!device) return null
  try {
    const info = await requestAuth('device', { device_token: device.token })
    saveDevice(info)
    return getDevice()
  } catch (err) {
    if (/sign in again/i.test(err.message || '')) clearDevice()
    throw err
  }
}

/** Sign back in on a remembered phone with the password or the phone's PIN. */
export async function unlockDevice({ password, pin }) {
  const device = getDevice()
  if (!device) throw new Error('Please sign in again.')
  try {
    const data = await requestAuth('unlock', { device_token: device.token, ...(pin ? { pin } : { password }) })
    saveSession(data.access_token)
    saveDevice({ has_pin: data.has_pin })
    return data
  } catch (err) {
    if (/sign in again/i.test(err.message || '')) clearDevice()
    throw err
  }
}

export async function setDevicePin(pin) {
  const device = getDevice()
  if (!device) throw new Error('This phone isn’t remembered.')
  await apiRequest('/api/v1/me/device-pin', { method: 'POST', body: JSON.stringify({ device_token: device.token, pin }) })
  saveDevice({ has_pin: true })
}

/** Sign out completely: this phone forgets the account. */
export async function signOutCompletely() {
  const device = getDevice()
  clearDevice()
  logoutPassenger()
  if (device) await requestAuth('forget-device', { device_token: device.token }).catch(() => {})
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

/** Which code channels (SMS, email) the server has switched on. */
export async function getAuthOptions() {
  try {
    const response = await fetch(apiUrl('/api/v1/auth/options'))
    if (!response.ok) throw new Error('unavailable')
    return await response.json()
  } catch {
    return { sms: false, email: false, password_reset: false }
  }
}

export const requestPasswordReset = (identifier) =>
  requestAuth('password-reset/request', { identifier: identifier.trim() })

export const confirmPasswordReset = ({ identifier, code, new_password }) =>
  requestAuth('password-reset/confirm', { identifier: identifier.trim(), code: code.trim(), new_password })

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

/** Replace the stored token (after a refresh or password change). */
export function updateAccessToken(token) {
  if (token) sessionStorage.setItem(TOKEN_KEY, token)
}

/** Seconds until the stored token expires, or 0 if missing/unreadable. */
export function tokenSecondsLeft() {
  const token = getAccessToken()
  if (!token) return 0
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const { exp } = JSON.parse(atob(part.padEnd(part.length + ((4 - (part.length % 4)) % 4), '=')))
    return Math.max(0, Math.floor(exp - Date.now() / 1000))
  } catch {
    return 0
  }
}

/** Fetch a protected image (e.g. an ID photo) and return an object URL. */
export async function fetchImageUrl(path) {
  const response = await fetch(apiUrl(path), {
    headers: { Authorization: `Bearer ${getAccessToken()}` },
  })
  if (!response.ok) throw new Error('Could not load the image.')
  const blob = await response.blob()
  if (!blob.type.startsWith('image/')) throw new Error('The server did not return an image.')
  return URL.createObjectURL(blob)
}

/** Download a protected file (e.g. a CSV report) to the device. */
export async function downloadFile(path, fallbackName = 'download.csv') {
  let response
  try {
    response = await fetch(apiUrl(path), { headers: { Authorization: `Bearer ${getAccessToken()}` } })
  } catch {
    throw new Error('Unable to reach EkiMove. Check your connection and try again.')
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(typeof data.detail === 'string' ? data.detail : 'Could not download the file.')
  }
  const disposition = response.headers.get('content-disposition') || ''
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] || fallbackName
  const url = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
