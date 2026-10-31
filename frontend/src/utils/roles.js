export function homePathForRole(role) {
  if (role === 'super_admin') return '/admin/overview'
  if (role === 'driver') return '/driver/trips'
  return '/dashboard'
}
