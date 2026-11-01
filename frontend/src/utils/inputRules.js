/**
 * What the sign-up, sign-in and contact fields accept. The server checks the
 * same rules (app/contacts.py); these give instant, friendly feedback and
 * stop stray characters being typed in the first place.
 */

export const NAME_MAX = 80
export const PASSWORD_MIN = 12
export const PASSWORD_MAX = 128

/** Keep only the characters a phone number is typed with. */
export function phoneTyping(value) {
  const text = String(value || '')
  const plus = text.trimStart().startsWith('+') ? '+' : ''
  return (plus + text.replace(/[^\d\s()-]/g, '')).slice(0, 18)
}

/** 0XXXXXXXXXX for a Nigerian mobile number in any common form, else null. */
export function nigerianMobile(value) {
  const text = String(value || '').trim()
  if (!text || !/^\+?[\d\s().-]{7,24}$/.test(text)) return null
  let digits = text.replace(/\D/g, '')
  if (digits.startsWith('234')) digits = `0${digits.slice(3).replace(/^0+/, '')}`
  else if (digits.length === 10 && /^[789]/.test(digits)) digits = `0${digits}`
  return /^0[789][01]\d{8}$/.test(digits) ? digits : null
}

export function phoneProblem(value) {
  if (!String(value || '').trim()) return 'Enter your phone number.'
  return nigerianMobile(value) ? '' : 'Enter a Nigerian mobile number, like 0803 123 4567.'
}

/** Letters (any language, with accents and tone marks), spaces, ' - . only. */
export function nameTyping(value) {
  return String(value || '')
    .replace(/[^\p{L}\p{M}\s'’.-]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .slice(0, NAME_MAX)
}

export function nameProblem(value, label = 'full name') {
  const text = String(value || '').normalize('NFC').trim().replace(/\s+/g, ' ')
  const letters = (text.match(/\p{L}/gu) || []).length
  if (letters < 2) return `Enter your ${label}.`
  if (text.length > NAME_MAX) return `Keep the ${label} to ${NAME_MAX} characters or fewer.`
  if (/[^\p{L}\p{M}\s'’.-]/u.test(text) || /\.\w/u.test(text)) {
    return `Use only letters, spaces, hyphens and apostrophes in the ${label}.`
  }
  if (!/^\p{L}/u.test(text)) return `Start the ${label} with a letter.`
  return ''
}

const EMAIL_RE =
  /^[a-z0-9](?:[a-z0-9._%+-]{0,62}[a-z0-9_%+-])?@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/

export function emailProblem(value) {
  const text = String(value || '').trim().toLowerCase()
  if (!text) return 'Enter your email address.'
  if (text.length > 254 || text.includes('..') || !EMAIL_RE.test(text) || text.split('@')[0].length > 64) {
    return 'Enter a valid email address, like name@example.com.'
  }
  return ''
}

/** Sign-in accepts a phone number or an email address. */
export function identifierProblem(value) {
  const text = String(value || '').trim()
  if (!text) return 'Enter your phone number or email address.'
  if (text.includes('@')) return emailProblem(text) ? 'Check your email address — it looks incomplete.' : ''
  return nigerianMobile(text) ? '' : 'Enter your phone number (like 0803 123 4567) or your email address.'
}

export function inviteTyping(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 40)
}

const COMMON_WORDS = new Set([
  'password', 'passw0rd', 'qwerty', 'qwertyuiop', 'asdfgh', 'asdfghjkl', 'zxcvbnm', 'letmein', 'welcome',
  'iloveyou', 'admin', 'administrator', 'ekimove', 'ekiti', 'abc', 'abcdef', 'abcdefgh', 'abcdefghijkl',
  'monkey', 'dragon', 'football', 'sunshine', 'princess', 'master', 'jesus', 'godisgood', 'blessing',
  'changeme', 'secret', 'nigeria', 'lagos', 'test', 'user', 'login',
])
const SEQUENCES = ['abcdefghijklmnopqrstuvwxyz', 'qwertyuiopasdfghjklzxcvbnm', '01234567890', '09876543210']

/** Why a new password is too easy to guess ('' when it's fine). */
export function passwordProblem(password, { name, phone, email } = {}) {
  const value = String(password || '')
  if (value.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`
  if (value.length > PASSWORD_MAX) return `Use ${PASSWORD_MAX} characters or fewer.`
  if (value !== value.trim()) return "Don't start or end your password with a space."
  const lowered = value.toLowerCase()
  if (new Set(lowered).size < 5) return 'Mix in more different letters or words.'
  const core = lowered.replace(/[^a-z0-9]/g, '')
  if (/^\d+$/.test(core)) return "Don't use only numbers. Add some words."
  const letters = lowered.replace(/[^a-z]/g, '')
  if (COMMON_WORDS.has(letters) || COMMON_WORDS.has(core)) return 'That password is too common.'
  if (core && SEQUENCES.some((seq) => (seq + seq).includes(core) || (letters.length >= 8 && (seq + seq).includes(letters)))) {
    return "Don't use a run of keys like abcdef or qwerty."
  }
  const digits = String(phone || '').replace(/\D/g, '')
  if (digits.length >= 7 && value.replace(/\D/g, '').includes(digits.slice(-7))) {
    return "Don't put your phone number in your password."
  }
  const local = String(email || '').split('@')[0].toLowerCase()
  if (local.length >= 4 && lowered.includes(local)) return "Don't put your email address in your password."
  const parts = String(name || '').toLowerCase().split(/[^a-z]+/).filter((part) => part.length >= 3)
  if (parts.length && letters && (parts.includes(letters) || letters === parts.join(''))) {
    return "Don't use just your name. Add other words."
  }
  return ''
}
