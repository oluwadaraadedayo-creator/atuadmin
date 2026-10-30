// Shared checks for the admin API. Files starting with "_" are not exposed as endpoints by Vercel.
import { createClient } from '@supabase/supabase-js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (s) => typeof s === 'string' && UUID.test(s)

export function adminClient() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Server is not configured')
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}

export function decodeClaims(token) {
  try { return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8')) } catch { return null }
}

// Three checks, all required: a valid sign-in, a session that passed two-factor (aal2), and an administrator role in the database.
// The role can only be set by running SQL in Supabase. Nothing on the website or in this app can grant it.
export async function requireAdmin(req, db, { mfa = true } = {}) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!token) return { status: 401, error: 'Please sign in' }
  const { data, error } = await db.auth.getUser(token)
  if (error || !data?.user) return { status: 401, error: 'Please sign in' }
  const claims = decodeClaims(token)
  if (mfa && (!claims || claims.aal !== 'aal2')) return { status: 403, code: 'MFA_REQUIRED', error: 'Two-factor sign-in is required' }
  const { data: profile } = await db.from('profiles').select('role').eq('id', data.user.id).maybeSingle()
  if (!profile || profile.role !== 'admin') return { status: 403, error: 'This account is not an administrator' }
  return { user: data.user }
}

export async function audit(db, adminId, action, targetType, targetId, details) {
  const { error } = await db.from('admin_audit_log').insert({ admin_id: adminId, action, target_type: targetType ?? null, target_id: targetId ?? null, details: details ?? {} })
  if (error) { console.error('audit write failed', action, error.code); return false }
  return true
}
