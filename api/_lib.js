// Shared helpers for the payment API. Files starting with "_" are not exposed as endpoints by Vercel.
import { createClient } from '@supabase/supabase-js'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { sendReceiptOnce } from './_email.js'

export const MIN_PWYW_NAIRA = 1000          // platform floor for pay-what-you-want
export const MAX_NAIRA = 500000             // sanity cap per purchase
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (s) => typeof s === 'string' && UUID.test(s)
export const REFERENCE = /^atu_[a-f0-9-]{36}$/i

export function applyCors(req, res) {
  const origin = process.env.ALLOWED_ORIGIN || 'https://oluwadaraadedayo-creator.github.io'
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Vary', 'Origin')
  if (req.method === 'OPTIONS') { res.status(204).end(); return true }
  return false
}

export function adminClient() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Server is not configured')
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}

export async function userFromRequest(req, db) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!token) return null
  const { data, error } = await db.auth.getUser(token)
  return error || !data?.user ? null : data.user
}

// Decides what the buyer actually pays. The browser can only ASK for an amount; the server decides.
export const MAX_QUANTITY = 10               // units one fan can buy in a single order
export const MAX_TOTAL_NAIRA = 1000000       // sanity cap on one whole order
export function resolveAmount(product, requestedNaira, quantity) {
  if (!Number.isSafeInteger(product.price_minor) || product.price_minor < 100) {
    return { status: 400, error: 'Release price is invalid' }
  }
  let unitMinor
  if (product.pricing_mode !== 'pay_what_you_want') {
    unitMinor = product.price_minor
  } else {
    const minNaira = Math.max(MIN_PWYW_NAIRA, Math.ceil((product.min_price_minor || 0) / 100))
    const naira = requestedNaira === undefined || requestedNaira === null ? Math.round(product.price_minor / 100) : requestedNaira
    if (!Number.isInteger(naira)) return { status: 400, error: 'Enter a whole naira amount' }
    if (naira < minNaira) return { status: 400, error: `The minimum for this release is ₦${minNaira.toLocaleString('en-NG')}` }
    if (naira > MAX_NAIRA) return { status: 400, error: `The maximum single payment is ₦${MAX_NAIRA.toLocaleString('en-NG')}` }
    unitMinor = naira * 100
  }
  const qty = quantity === undefined || quantity === null ? 1 : quantity
  if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QUANTITY) return { status: 400, error: `Choose between 1 and ${MAX_QUANTITY} units` }
  const total = unitMinor * qty
  if (total > MAX_TOTAL_NAIRA * 100) return { status: 400, error: `One order is limited to ₦${MAX_TOTAL_NAIRA.toLocaleString('en-NG')}. Choose fewer units.` }
  return { amountMinor: total, unitMinor, quantity: qty }
}

// The platform fee, read from PLATFORM_FEE_PERCENT in one place so every part of the system agrees.
// Accepts 20 or 20% (a pasted percent sign is a common slip). Anything unreadable falls back to 10 and says so ("invalid").
export function platformFeePercent() {
  const raw = process.env.PLATFORM_FEE_PERCENT
  if (raw === undefined || String(raw).trim() === '') return { value: 10, source: 'default' }
  const text = String(raw).trim().replace(/%$/, '').trim()
  const n = /^\d+(\.\d+)?$/.test(text) ? Number(text) : NaN
  if (!Number.isFinite(n) || n < 0 || n > 50) return { value: 10, source: 'invalid' }
  return { value: n, source: 'env' }
}

// Which Paystack mode the secret key belongs to. Never returns the key itself.
export function paystackMode() {
  const k = String(process.env.PAYSTACK_SECRET_KEY || '')
  return k.startsWith('sk_live_') ? 'live' : k.startsWith('sk_test_') ? 'test' : 'none'
}

// Splits the payment between the platform and the artist's Paystack subaccount.
export function splitFor({ amountMinor, subaccountCode, feePercent, bearer }) {
  if (!subaccountCode) return { fee: 0, extra: {} }
  const pct = Number.isFinite(feePercent) && feePercent >= 0 && feePercent <= 50 ? feePercent : 10
  const fee = Math.round((amountMinor * pct) / 100)
  return { fee, extra: { subaccount: subaccountCode, transaction_charge: fee, bearer: bearer === 'subaccount' ? 'subaccount' : 'account' } }
}

export function validSignature(rawBody, signature, secret) {
  if (!rawBody || !signature || !secret) return false
  const expected = createHmac('sha512', secret).update(rawBody).digest('hex')
  const a = Buffer.from(expected, 'utf8'), b = Buffer.from(String(signature), 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function readRawBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  return Buffer.concat(chunks).toString('utf8')
}

// Asks Paystack whether this payment really succeeded, then marks the order paid. Used by the
// browser callback AND the webhook, so a payment is confirmed once, from one trusted place.
export async function confirmPayment(db, secret, reference) {
  if (!REFERENCE.test(String(reference || ''))) return { code: 400, error: 'A valid payment reference is required' }
  const { data: order, error } = await db.from('orders')
    .select('id,amount_minor,currency,status,product_id,buyer_email').eq('payment_reference', reference).single()
  if (error || !order) return { code: 404, error: 'Order not found' }
  if (order.status === 'paid') { await sendReceiptOnce(db, order.id); return { code: 200, verified: true, orderId: order.id, productId: order.product_id } }
  if (['refunded', 'disputed'].includes(order.status)) return { code: 409, verified: false, error: 'This order is no longer active' }
  const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, { headers: { Authorization: `Bearer ${secret}` } })
  const payload = await response.json().catch(() => null)
  const tx = payload?.data
  const valid = response.ok && payload?.status && tx?.status === 'success' && tx?.reference === reference &&
    Number(tx?.amount) === Number(order.amount_minor) && tx?.currency === order.currency &&
    String(tx?.customer?.email || '').toLowerCase() === String(order.buyer_email).toLowerCase()
  if (!valid) {
    await db.from('orders').update({ status: 'verification_failed' }).eq('id', order.id).eq('status', 'pending')
    return { code: 402, verified: false, error: 'Payment could not be verified against the order' }
  }
  const { data: updated, error: updateError } = await db.from('orders')
    .update({ status: 'paid', paid_at: new Date().toISOString(), provider_transaction_id: String(tx.id) })
    .eq('id', order.id).in('status', ['pending', 'verification_failed']).select('id')
  if (updateError) {
    // 23505 = this buyer already owns the release (two payments raced). Needs a manual refund.
    console.error('confirmPayment update failed', updateError.code, reference)
    return { code: updateError.code === '23505' ? 409 : 500, verified: false, error: updateError.code === '23505' ? 'You already own this release. Contact support for a refund.' : 'Verified payment could not be recorded' }
  }
  await sendReceiptOnce(db, order.id)   // never throws, and never blocks the payment from being confirmed
  return { code: 200, verified: true, orderId: order.id, productId: order.product_id }
}

// ---------------------------------------------------------------------------
// Audio helpers
// ---------------------------------------------------------------------------
export const AUDIO_BUCKET = 'audio'
export const MAX_AUDIO_BYTES = 52428800      // 50 MB per file (matches the storage bucket limit)
export const MAX_FILES_PER_RELEASE = 40
export const DOWNLOAD_LINK_SECONDS = 600     // signed links expire after 10 minutes
export const DOWNLOADS_PER_HOUR = 20         // per buyer per release, to discourage link sharing
export const AUDIO_PATH = (userId, productId) => new RegExp(`^${userId}/${productId}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(mp3|wav|flac|m4a|aac|ogg)$`, 'i')

const KIND_MIME = { mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', mp4: 'audio/mp4', ogg: 'audio/ogg' }
const KIND_EXT = { mp3: ['mp3', 'aac'], wav: ['wav'], flac: ['flac'], mp4: ['m4a', 'aac'], ogg: ['ogg'] }

// Looks at the first bytes of a file to decide what it really is, whatever it is named.
export function sniffAudio(bytes) {
  if (!bytes || bytes.length < 12) return null
  const s = (a, b) => String.fromCharCode(...Array.from(bytes.slice(a, b)))
  if (s(0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return { kind: 'mp3', mime: KIND_MIME.mp3 }
  if (s(0, 4) === 'RIFF' && s(8, 12) === 'WAVE') return { kind: 'wav', mime: KIND_MIME.wav }
  if (s(0, 4) === 'fLaC') return { kind: 'flac', mime: KIND_MIME.flac }
  if (s(4, 8) === 'ftyp') return { kind: 'mp4', mime: KIND_MIME.mp4 }
  if (s(0, 4) === 'OggS') return { kind: 'ogg', mime: KIND_MIME.ogg }
  return null
}
export const extMatchesKind = (kind, ext) => (KIND_EXT[kind] || []).includes(String(ext).toLowerCase())

export function safeFilename(position, title, ext) {
  const clean = String(title || 'track').replace(/[^\p{L}\p{N} ._()-]/gu, '').replace(/\.{2,}/g, '').replace(/\s+/g, ' ').replace(/^[.\s]+/, '').trim().slice(0, 80) || 'track'
  return `${String(Number(position) + 1).padStart(2, '0')} - ${clean}.${ext}`
}

// Reads just the first bytes of a stored file through a short signed link, and its total size.
export async function peekFile(db, path, bucket = AUDIO_BUCKET) {
  const { data, error } = await db.storage.from(bucket).createSignedUrl(path, 60)
  if (error || !data?.signedUrl) return null
  const res = await fetch(data.signedUrl, { headers: { Range: 'bytes=0-15' } })
  if (!res.ok && res.status !== 206) return null
  let head
  if (res.body?.getReader) {
    const reader = res.body.getReader(); const parts = []; let n = 0
    while (n < 16) { const { done, value } = await reader.read(); if (done) break; parts.push(value); n += value.length }
    await reader.cancel().catch(() => {}); head = Buffer.concat(parts.map((p) => Buffer.from(p)))
  } else {
    head = Buffer.from(await res.arrayBuffer()).subarray(0, 16)
  }
  const range = res.headers.get('content-range'); const total = range ? Number(range.split('/')[1]) : Number(res.headers.get('content-length'))
  return { head, size: Number.isFinite(total) ? total : 0 }
}

export function ipHash(req) {
  const ip = String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown').split(',')[0].trim()
  const salt = process.env.IP_HASH_SALT || process.env.SUPABASE_SERVICE_ROLE_KEY || 'atu'
  return createHmac('sha256', salt).update(ip).digest('hex').slice(0, 32)
}

// ---------------------------------------------------------------------------
// Artwork (cover image) helpers
// ---------------------------------------------------------------------------
export const IMAGE_BUCKET = 'artwork'
export const MAX_IMAGE_BYTES = 5242880       // 5 MB (matches the storage bucket limit)
export const ARTWORK_PATH = (userId, productId) => new RegExp(`^${userId}/${productId}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(jpg|png|webp)$`, 'i')

// Decides what an image file really is from its first bytes. Only JPEG, PNG and WebP are accepted:
// no SVG (it can carry scripts) and no GIF.
export function sniffImage(bytes) {
  if (!bytes || bytes.length < 12) return null
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { kind: 'jpg', mime: 'image/jpeg' }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (png.every((b, i) => bytes[i] === b)) return { kind: 'png', mime: 'image/png' }
  const s = (a, b) => String.fromCharCode(...Array.from(bytes.slice(a, b)))
  if (s(0, 4) === 'RIFF' && s(8, 12) === 'WEBP') return { kind: 'webp', mime: 'image/webp' }
  return null
}

// ---------------------------------------------------------------------------
// Preview clips (short, compressed, playable before buying)
// ---------------------------------------------------------------------------
export const MAX_PREVIEW_BYTES = 3145728         // 3 MB
export const MAX_PREVIEWS_PER_RELEASE = 10
export const PREVIEW_LINK_SECONDS = 3600
export const PREVIEW_PATH = (userId, productId) => new RegExp(`^${userId}/${productId}/p-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(mp3|m4a|aac|ogg)$`, 'i')
// Previews must be compressed formats. WAV and FLAC files are too large and would give the track away.
export const previewKindOk = (kind, ext) => ['mp3', 'mp4', 'ogg'].includes(kind) && extMatchesKind(kind, ext)
