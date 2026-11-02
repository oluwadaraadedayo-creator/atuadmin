import { supabase } from './supabase'

export type ApiResult<T = any> = { ok: boolean; status: number; data?: T; error?: string; code?: string; auditWarning?: boolean }

// Every admin action goes through this one function to our own server, which checks sign-in, two-factor and the admin role.
export async function adminApi<T = any>(action: string, params: Record<string, unknown> = {}): Promise<ApiResult<T>> {
  const token = (await supabase?.auth.getSession())?.data.session?.access_token
  if (!token) return { ok: false, status: 401, error: 'Please sign in' }
  try {
    const res = await fetch('/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ action, ...params }) })
    const j = await res.json().catch(() => ({}))
    return res.ok ? { ok: true, status: res.status, data: j.data, auditWarning: j.auditWarning } : { ok: false, status: res.status, error: j.error || 'Request failed', code: j.code }
  } catch { return { ok: false, status: 0, error: 'Could not reach the server' } }
}

export const money = (minor: number) => `₦${Math.round((minor || 0) / 100).toLocaleString('en-NG')}`
export const when = (iso?: string | null) => iso ? new Date(iso).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' }) : ''
