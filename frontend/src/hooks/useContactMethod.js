import { useState } from 'react'
import { emailProblem, nigerianMobile, phoneProblem, phoneTyping } from '../utils/inputRules.js'

const KEY = 'ekimove_signin_method'

function remembered() {
  try {
    return localStorage.getItem(KEY) === 'email' ? 'email' : 'phone'
  } catch {
    return 'phone'
  }
}

/**
 * Phone-or-email state for sign-in and password reset. Starts on the method
 * of an identifier handed over from another page, otherwise the one last used.
 */
export default function useContactMethod(initial = '') {
  const start = String(initial || '').trim()
  const [method, setMethodState] = useState(start ? (start.includes('@') ? 'email' : 'phone') : remembered)
  const [phone, setPhone] = useState(start && !start.includes('@') ? phoneTyping(start) : '')
  const [email, setEmail] = useState(start.includes('@') ? start.toLowerCase() : '')

  function setMethod(next) {
    setMethodState(next)
    try {
      localStorage.setItem(KEY, next)
    } catch {
      // Remembering the choice is only a convenience.
    }
  }

  const problem = method === 'phone' ? phoneProblem(phone) : emailProblem(email)
  const identifier = method === 'phone' ? nigerianMobile(phone) || '' : email.trim().toLowerCase()

  return { method, setMethod, phone, setPhone, email, setEmail, problem, identifier }
}
