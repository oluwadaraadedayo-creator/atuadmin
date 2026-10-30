import { adminClient, requireAdmin, audit, isUuid } from './_guard.js'

const PAGE = 25
const bad = (message, status = 400) => Object.assign(new Error(message), { status })
const uuid = (v, label = 'id') => { if (!isUuid(v)) throw bad(`A valid ${label} is required`); return v }
const text = (v, min, max, label) => { const s = String(v ?? '').trim(); if (s.length < min || s.length > max) throw bad(`${label} must be ${min} to ${max} characters`); return s }
const search = (v) => String(v ?? '').trim().slice(0, 100)
const pick = (v, list, label) => { const s = String(v ?? ''); if (s !== '' && !list.includes(s)) throw bad(`Invalid ${label}`); return s }
const pageNo = (v) => { const n = v === undefined || v === null ? 0 : Number(v); if (!Number.isInteger(n) || n < 0 || n > 10000) throw bad('Invalid page'); return n }
const flag = (v, label) => { if (typeof v !== 'boolean') throw bad(`${label} must be true or false`); return v }

async function rpc(db, name, args) {
  const { data, error } = await db.rpc(name, args)
  if (error) { console.error('rpc failed', name, error.code); throw bad('The database could not complete that request', 500) }
  return data
}
const listed = (rows, page) => ({ rows: (rows || []).slice(0, PAGE), page, pageSize: PAGE, hasMore: (rows || []).length > PAGE })

const ACTIONS = {
  // The only action that works without two-factor. It says whether this account is an administrator, so anyone else is turned away straight after sign-in.
  whoami: async ({ admin }) => ({ id: admin.id, email: admin.email }),

  overview: ({ db }) => rpc(db, 'admin_overview', {}),

  'users.list': async ({ db, p }) => {
    const page = pageNo(p.page)
    return listed(await rpc(db, 'admin_find_users', { p_q: search(p.q), p_role: pick(p.role, ['fan', 'artist', 'admin'], 'role'), p_limit: PAGE + 1, p_offset: page * PAGE }), page)
  },

  'user.update': async ({ db, admin, p }) => {
    const userId = uuid(p.userId, 'user'); const ch = p.changes
    if (!ch || typeof ch !== 'object' || Array.isArray(ch)) throw bad('Nothing to change')
    const allowed = ['role', 'verified', 'featuredOrder', 'hidden', 'suspended']
    const keys = Object.keys(ch)
    if (!keys.length || keys.some((k) => !allowed.includes(k))) throw bad('Unknown change requested')
    if (userId === admin.id) throw bad('You cannot change your own account here')
    const { data: target } = await db.from('profiles').select('id,role,verified_artist,featured_order,hidden_from_makers').eq('id', userId).maybeSingle()
    if (!target) throw bad('Account not found', 404)
    if (target.role === 'admin') throw bad('Administrator accounts can only be changed in the database', 403)
    const before = { role: target.role, verified: target.verified_artist, featuredOrder: target.featured_order, hidden: target.hidden_from_makers }   // snapshot before anything changes

    const updates = {}; let roleAfter = target.role
    if ('role' in ch) {
      if (!['fan', 'artist'].includes(ch.role)) throw bad('Role must be fan or artist')
      updates.role = ch.role; roleAfter = ch.role
      if (ch.role === 'fan') { updates.verified_artist = false; updates.featured_order = null }
    }
    if ('verified' in ch) {
      flag(ch.verified, 'verified')
      if (roleAfter !== 'artist') throw bad('Only artists can be verified')
      updates.verified_artist = ch.verified
    }
    if ('featuredOrder' in ch) {
      const v = ch.featuredOrder
      if (v !== null && (!Number.isInteger(v) || v < 1 || v > 99)) throw bad('Feature order must be 1 to 99, or empty')
      if (v !== null && roleAfter !== 'artist') throw bad('Only artists can be featured')
      updates.featured_order = v
    }
    if ('hidden' in ch) updates.hidden_from_makers = flag(ch.hidden, 'hidden')
    if (Object.keys(updates).length) {
      const { error } = await db.from('profiles').update(updates).eq('id', userId)
      if (error) { console.error('user.update failed', error.code); throw bad('Could not save that change', 500) }
    }
    if ('suspended' in ch) {
      const on = flag(ch.suspended, 'suspended')
      const row = on ? { profile_id: userId, suspended_at: new Date().toISOString() } : { profile_id: userId, suspended_at: null, strikes: 0 }
      const { error } = await db.from('creator_compliance').upsert(row, { onConflict: 'profile_id' })
      if (error) { console.error('suspension failed', error.code); throw bad('Could not save that change', 500) }
    }
    return { result: { ok: true }, audit: ['user.update', 'user', userId, { changes: ch, before }] }
  },

  'reports.list': async ({ db, p }) => {
    const page = pageNo(p.page)
    return listed(await rpc(db, 'admin_list_reports', { p_status: pick(p.status, ['open', 'actioned', 'rejected', 'counter_notice'], 'status'), p_limit: PAGE + 1, p_offset: page * PAGE }), page)
  },

  'report.dismiss': async ({ db, p }) => {
    const id = uuid(p.reportId, 'report'); const note = text(p.note, 3, 300, 'Note')
    const { data, error } = await db.from('takedown_reports').update({ status: 'rejected', handled_at: new Date().toISOString(), resolution: note }).eq('id', id).in('status', ['open', 'counter_notice']).select('id')
    if (error) throw bad('Could not save that change', 500)
    if (!data?.length) throw bad('That report is not open', 409)
    return { result: { ok: true }, audit: ['report.dismiss', 'report', id, { note }] }
  },

  'products.list': async ({ db, p }) => {
    const page = pageNo(p.page)
    return listed(await rpc(db, 'admin_list_products', { p_q: search(p.q), p_status: pick(p.status, ['draft', 'published', 'archived', 'removed'], 'status'), p_limit: PAGE + 1, p_offset: page * PAGE }), page)
  },

  'product.takedown': async ({ db, p }) => {
    const id = uuid(p.productId, 'release'); const reason = text(p.reason, 3, 300, 'Reason')
    const { data: product } = await db.from('products').select('id,status').eq('id', id).maybeSingle()
    if (!product) throw bad('Release not found', 404)
    if (product.status === 'removed') throw bad('This release is already removed', 409)
    const result = await rpc(db, 'takedown_product', { p_product: id, p_reason: reason })
    return { result, audit: ['product.takedown', 'product', id, { reason, outcome: result }] }
  },

  'product.restore': async ({ db, p }) => {
    const id = uuid(p.productId, 'release'); const note = text(p.note, 3, 300, 'Note')
    const { data: product } = await db.from('products').select('id,status').eq('id', id).maybeSingle()
    if (!product) throw bad('Release not found', 404)
    if (product.status !== 'removed') throw bad('Only removed releases can be restored', 409)
    const result = await rpc(db, 'restore_product', { p_product: id, p_note: note })
    return { result, audit: ['product.restore', 'product', id, { note, outcome: result }] }
  },

  'orders.list': async ({ db, p }) => {
    const page = pageNo(p.page); const q = search(p.q); const status = pick(p.status, ['pending', 'paid', 'refunded', 'disputed', 'verification_failed', 'payment_initialization_failed'], 'status')
    const rows = await rpc(db, 'admin_list_orders', { p_q: q, p_status: status, p_limit: PAGE + 1, p_offset: page * PAGE })
    return { result: listed(rows, page), audit: ['orders.view', 'orders', null, { q, status, page }] }   // buyer emails are personal data, so viewing them is logged
  },

  'order.markRefunded': async ({ db, p }) => {
    const id = uuid(p.orderId, 'order'); const note = text(p.note, 3, 300, 'Note')
    if (p.refundedInPaystack !== true) throw bad('Confirm that you have already refunded the money in Paystack')
    const { data: order } = await db.from('orders').select('id,status').eq('id', id).maybeSingle()
    if (!order) throw bad('Order not found', 404)
    if (order.status !== 'paid') throw bad('Only paid orders can be marked refunded', 409)
    const { error } = await db.from('orders').update({ status: 'refunded', refunded_at: new Date().toISOString() }).eq('id', id).eq('status', 'paid')
    if (error) throw bad('Could not save that change', 500)
    return { result: { ok: true }, audit: ['order.markRefunded', 'order', id, { note }] }
  },

  'categories.list': async ({ db }) => {
    const { data, error } = await db.from('categories').select('slug,group_name,label,fulfillment,enabled,sort').order('sort')
    if (error) throw bad('Could not load categories', 500)
    return data || []
  },

  'category.set': async ({ db, p }) => {
    const slug = text(p.slug, 3, 60, 'Category'); const enabled = flag(p.enabled, 'enabled')
    const { data, error } = await db.from('categories').update({ enabled }).eq('slug', slug).select('slug')
    if (error) throw bad('Could not save that change', 500)
    if (!data?.length) throw bad('Category not found', 404)
    return { result: { ok: true }, audit: ['category.set', 'category', slug, { enabled }] }
  },

  'audit.list': async ({ db, p }) => {
    const page = pageNo(p.page)
    const { data, error } = await db.from('admin_audit_log').select('id,admin_id,action,target_type,target_id,details,created_at').order('created_at', { ascending: false }).range(page * PAGE, page * PAGE + PAGE)
    if (error) throw bad('Could not load the activity log', 500)
    const ids = [...new Set((data || []).map((r) => r.admin_id))]
    const { data: people } = ids.length ? await db.from('profiles').select('id,display_name').in('id', ids) : { data: [] }
    const names = Object.fromEntries((people || []).map((x) => [x.id, x.display_name]))
    return listed((data || []).map((r) => ({ ...r, admin_name: names[r.admin_id] || null })), page)
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  // This API is meant to be called only by the admin page on the same address.
  const origin = req.headers.origin
  if (origin) { let host = ''; try { host = new URL(origin).host } catch { /* ignore */ } if (host !== req.headers.host) return res.status(403).json({ error: 'Not allowed' }) }
  try {
    const db = adminClient()
    const { action, ...p } = req.body || {}
    const who = await requireAdmin(req, db, { mfa: action !== 'whoami' })
    if (who.error) return res.status(who.status).json({ error: who.error, code: who.code })
    const fn = Object.prototype.hasOwnProperty.call(ACTIONS, action) ? ACTIONS[action] : null
    if (!fn) return res.status(400).json({ error: 'Unknown action' })
    const out = await fn({ db, admin: who.user, p })
    let data = out, auditWarning = false
    if (out && typeof out === 'object' && 'audit' in out && ('result' in out)) {
      data = out.result
      auditWarning = !(await audit(db, who.user.id, out.audit[0], out.audit[1], out.audit[2], out.audit[3]))
    }
    return res.status(200).json({ ok: true, data, auditWarning })
  } catch (error) {
    if (error?.status) return res.status(error.status).json({ error: error.message })
    console.error('admin api failed', error)
    return res.status(500).json({ error: 'Something went wrong' })
  }
}
