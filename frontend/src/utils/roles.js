// Which staff permission opens each console page ('super' = super-admins only,
// [] = any team member). Kept in step with app/auth.py STAFF_PERMISSIONS.
export const ADMIN_PAGES = {
  '/admin/overview': [],
  '/admin/launch': 'super',
  '/admin/map': ['dispatch', 'support'],
  '/admin/dispatch': ['dispatch'],
  '/admin/loads': ['dispatch', 'finance'],
  '/admin/support': ['support'],
  '/admin/people': ['support', 'drivers'],
  '/admin/payments': ['finance'],
  '/admin/earnings': ['finance'],
  '/admin/reports': ['finance'],
  '/admin/promos': ['website'],
  '/admin/incidents': ['dispatch', 'support'],
  '/admin/drivers': ['drivers'],
  '/admin/locations': 'super',
  '/admin/fares': 'super',
  '/admin/website': ['website'],
  '/admin/team': 'super',
  '/admin/staff-cards': 'super',
  '/admin/pins': ['pins'],
}

export const STAFF_ROLES = ['super_admin', 'staff']

export function isSuperAdmin(user) {
  return user?.role === 'super_admin'
}

/** Can this signed-in person open the console page at `path`? */
export function canOpen(user, path) {
  if (!user) return false
  if (user.role === 'super_admin') return true
  if (user.role !== 'staff') return false
  const page = Object.keys(ADMIN_PAGES).find((key) => path === key || path.startsWith(`${key}/`) || path.startsWith(`${key}?`))
  const need = page ? ADMIN_PAGES[page] : 'super'
  if (need === 'super') return false
  const granted = user.staff_permissions || []
  return need.length === 0 ? granted.length > 0 : need.some((p) => granted.includes(p))
}

/** Can this person use any of these permissions (super-admins: always)? */
export function hasPermission(user, ...permissions) {
  if (user?.role === 'super_admin') return true
  const granted = user?.role === 'staff' ? user.staff_permissions || [] : []
  return permissions.some((p) => granted.includes(p))
}

export function homePathForRole(role) {
  if (role === 'super_admin' || role === 'staff') return '/admin/overview'
  if (role === 'driver') return '/driver/trips'
  return '/dashboard'
}
