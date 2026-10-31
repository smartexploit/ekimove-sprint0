export function homePathForRole(role) {
  if (role === 'super_admin') return '/admin/dispatch'
  if (role === 'driver') return '/driver/trips'
  return '/dashboard'
}
