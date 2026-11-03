// Email for A Thousand Units. Files starting with "_" are not exposed as endpoints by Vercel.
// Provider: Resend (https://resend.com). To use a different provider, replace deliver() and nothing else.
//
// Rules this file keeps:
//  - Sending email must NEVER break a payment or a report. Every public function here catches its own errors.
//  - A receipt is sent once per order, even if the payment callback and the webhook both arrive.
//  - Anything an artist or a stranger typed is HTML-escaped before it goes into an email.

const RESEND_URL = 'https://api.resend.com/emails'

export const emailConfigured = () => Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM)

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
// Single line, no control characters, so text can safely sit in a subject line.
export const oneLine = (s, max = 150) => String(s ?? '').replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
export const money = (minor, currency = 'NGN') => currency === 'NGN' ? `₦${Math.round((Number(minor) || 0) / 100).toLocaleString('en-NG')}` : `${((Number(minor) || 0) / 100).toFixed(2)} ${currency}`
const EMAIL = /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/
const validEmails = (list) => (Array.isArray(list) ? list : [list]).map((x) => String(x ?? '').trim()).filter((x) => EMAIL.test(x) && x.length <= 200).slice(0, 5)
const siteRoot = () => String(process.env.SITE_URL || '').replace(/\/+$/, '')
const safeUrl = (u) => (/^https?:\/\//i.test(u) ? u : '')

export const adminRecipients = () => validEmails(String(process.env.ADMIN_ALERT_EMAIL || '').split(','))

// ---------------------------------------------------------------------------
// The one place that talks to the provider
// ---------------------------------------------------------------------------
// The sender address, tidied. A pasted value often carries quotation marks, spaces or a line break, which the email provider rejects.
const cleanFrom = () => String(process.env.EMAIL_FROM || '').replace(/[\r\n\u2028\u2029]+/g, ' ').trim().replace(/^["'`\u201c\u201d]+|["'`\u201c\u201d]+$/g, '').trim()
const validFrom = (f) => /^[^<>@\s][^<>]*<[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+>$/.test(f) || /^[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+$/.test(f)
const senderOnly = (f) => { const m = f.match(/<([^<>]+)>$/); return (m ? m[1] : f).slice(0, 120) }

async function deliver({ to, subject, html, text }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Number(process.env.EMAIL_TIMEOUT_MS) || 5000)
  try {
    const from = cleanFrom()
    if (!validFrom(from)) return { ok: false, error: `EMAIL_FROM is not valid. It must look like: Name <hello@yourdomain.com>. Right now it starts with: ${from.slice(0, 15) || '(empty)'}` }
    const body = { from, to, subject, html, text }
    if (process.env.EMAIL_REPLY_TO) body.reply_to = process.env.EMAIL_REPLY_TO
    const res = await fetch(RESEND_URL, {
      method: 'POST', signal: controller.signal,
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    const payload = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: oneLine(payload?.message || payload?.name || `Provider returned ${res.status}`, 200) }
    return { ok: true, id: payload?.id ? String(payload.id) : null }
  } catch (e) {
    return { ok: false, error: e?.name === 'AbortError' ? 'The email provider took too long to answer' : oneLine(e?.message || 'Could not reach the email provider', 200) }
  } finally { clearTimeout(timer) }
}

async function record(db, entry) {
  try { await db.from('email_log').insert(entry) } catch { /* the log is best effort */ }
}

// Sends one email and writes a log row. Never throws.
export async function sendEmail(db, { template, ref, to, subject, html, text }) {
  try {
    const recipients = validEmails(to)
    if (!emailConfigured()) { await record(db, { template, ref: ref ?? null, status: 'skipped', error: 'Email is not configured' }); return { ok: false, skipped: true } }
    if (!recipients.length) { await record(db, { template, ref: ref ?? null, status: 'failed', error: 'No valid recipient' }); return { ok: false, error: 'No valid recipient' } }
    const r = await deliver({ to: recipients, subject: oneLine(subject, 200), html, text })
    const sender = senderOnly(cleanFrom())
    const hint = /@resend\.dev$/i.test(sender) ? ' This is Resend\'s test address. Use an address on your verified domain.' : ''
    await record(db, { template, ref: ref ?? null, status: r.ok ? 'sent' : 'failed', provider_id: r.id ?? null, error: r.ok ? null : `${r.error} [sender used: ${sender}]${hint}`.slice(0, 500) })
    if (!r.ok) console.error('email failed', template, r.error)
    return r
  } catch (e) { console.error('sendEmail crashed', template, e?.message); return { ok: false, error: 'Unexpected email error' } }
}

// ---------------------------------------------------------------------------
// Layout and templates
// ---------------------------------------------------------------------------
const wrap = (inner) => `<div style="font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;max-width:540px;margin:0 auto;padding:24px;color:#191a17;line-height:1.55">
<p style="font-size:12px;letter-spacing:.12em;color:#6f7168;margin:0 0 18px">A THOUSAND UNITS</p>${inner}</div>`
const row = (k, v) => `<tr><td style="padding:8px 0;color:#6f7168;width:38%;border-bottom:1px solid #e7e7e0">${esc(k)}</td><td style="padding:8px 0;border-bottom:1px solid #e7e7e0">${v}</td></tr>`

export function receiptEmail({ title, artist, quantity = 1, amountMinor, currency = 'NGN', reference, paidAt }) {
  const site = safeUrl(siteRoot()); const date = paidAt ? new Date(paidAt).toLocaleDateString('en-NG', { dateStyle: 'long' }) : ''
  const units = Number(quantity) > 1 ? `${quantity} units (you get one copy, the extra units support the artist)` : ''
  const chargedBy = oneLine(String(process.env.CHARGED_BY_NAME || '').replace(/[<>]/g, ''), 60)
  const subject = `Your receipt for "${oneLine(title, 80)}"`
  const html = wrap(`<h1 style="font-size:22px;margin:0 0 10px">Thank you for your purchase</h1>
<p style="margin:0 0 16px">You bought <b>${esc(title)}</b> by ${esc(artist)}. It is now in your library.</p>
<table style="width:100%;border-collapse:collapse;font-size:14px">${row('Release', esc(title))}${row('Artist', esc(artist))}${units ? row('Units', esc(units)) : ''}${row('Amount paid', `<b>${esc(money(amountMinor, currency))}</b>`)}${date ? row('Date', esc(date)) : ''}${row('Reference', `<code>${esc(reference)}</code>`)}</table>
${site ? `<p style="margin:20px 0"><a href="${esc(site)}/" style="background:#191a17;color:#fff;padding:11px 18px;border-radius:3px;text-decoration:none;font-weight:600">Open A Thousand Units</a></p><p style="font-size:13px">Sign in and open <b>My Library</b> to listen and download.</p>` : '<p style="font-size:13px">Sign in and open <b>My Library</b> to listen and download.</p>'}
<p style="font-size:12px;color:#6f7168;margin-top:22px">Download links expire after 10 minutes. You can get fresh ones any time from the release page.${site ? ` Our <a href="${esc(site)}/#/refunds" style="color:#6f7168">refund policy</a> explains what to do if something is wrong.` : ''} ${chargedBy ? ` Your payment was collected by ${esc(chargedBy)} on behalf of A Thousand Units.` : ''} Keep the reference above if you need to contact us.</p>`)
  const text = [`Thank you for your purchase`, ``, `You bought "${oneLine(title, 200)}" by ${oneLine(artist, 100)}. It is now in your library.`, ``,
    `Release: ${oneLine(title, 200)}`, `Artist: ${oneLine(artist, 100)}`, ...(units ? [`Units: ${units}`] : []), `Amount paid: ${money(amountMinor, currency)}`, ...(date ? [`Date: ${date}`] : []), `Reference: ${oneLine(reference, 100)}`, ``,
    `Sign in and open My Library to listen and download.${site ? ` ${site}/` : ''}`, `Download links expire after 10 minutes. You can get fresh ones any time from the release page.`, ...(chargedBy ? [`Your payment was collected by ${chargedBy} on behalf of A Thousand Units.`] : []), ...(site ? [`Refund policy: ${site}/#/refunds`] : [])].join('\n')
  return { subject, html, text }
}

export function reportAlertEmail({ productTitle, artistName, reporterName, reporterEmail, relationship, description }) {
  const adminUrl = safeUrl(String(process.env.ADMIN_URL || '').replace(/\/+$/, ''))
  const rel = String(relationship || '').replace(/_/g, ' ')
  const subject = `New copyright report: "${oneLine(productTitle, 80)}"`
  const html = wrap(`<h1 style="font-size:20px;margin:0 0 10px">A copyright report needs review</h1>
<table style="width:100%;border-collapse:collapse;font-size:14px">${row('Release', esc(productTitle))}${row('Artist', esc(artistName))}${row('Reported by', `${esc(reporterName)} (${esc(reporterEmail)})`)}${row('Connection', esc(rel))}</table>
<p style="margin:16px 0 6px;color:#6f7168;font-size:12px">What they wrote</p>
<p style="border-left:3px solid #d4ff3f;padding:2px 12px;margin:0 0 18px">${esc(description).replace(/\n/g, '<br>')}</p>
${adminUrl ? `<p><a href="${esc(adminUrl)}" style="background:#191a17;color:#fff;padding:11px 18px;border-radius:3px;text-decoration:none;font-weight:600">Open the admin</a></p>` : ''}
<p style="font-size:12px;color:#6f7168">Review it in the admin under Reports. You can take the release down or dismiss the report there.</p>`)
  const text = [`A copyright report needs review`, ``, `Release: ${oneLine(productTitle, 200)}`, `Artist: ${oneLine(artistName, 100)}`, `Reported by: ${oneLine(reporterName, 100)} (${oneLine(reporterEmail, 200)})`, `Connection: ${oneLine(rel, 50)}`, ``, `What they wrote:`, String(description ?? ''), ``, adminUrl ? `Admin: ${adminUrl}` : `Review it in the admin under Reports.`].join('\n')
  return { subject, html, text }
}

// ---------------------------------------------------------------------------
// What the rest of the API calls
// ---------------------------------------------------------------------------

// Sends the buyer's receipt exactly once. The order is "claimed" first, so if the payment callback and the
// webhook arrive together only one of them sends. If sending fails the claim is released so a later call can retry.
export async function sendReceiptOnce(db, orderId) {
  let claimed = false
  try {
    if (!emailConfigured()) return
    const { data } = await db.from('orders').update({ receipt_sent_at: new Date().toISOString() })
      .eq('id', orderId).eq('status', 'paid').is('receipt_sent_at', null)
      .select('id,buyer_email,amount_minor,quantity,currency,payment_reference,paid_at,product_id,creator_id')
    const order = data?.[0]
    if (!order) return
    claimed = true
    const [{ data: product }, { data: artist }] = await Promise.all([
      db.from('products').select('title').eq('id', order.product_id).maybeSingle(),
      db.from('profiles').select('display_name').eq('id', order.creator_id).maybeSingle()
    ])
    const mail = receiptEmail({ title: product?.title || 'your release', artist: artist?.display_name || 'the artist', quantity: order.quantity, amountMinor: order.amount_minor, currency: order.currency, reference: order.payment_reference, paidAt: order.paid_at })
    const r = await sendEmail(db, { template: 'receipt', ref: order.id, to: order.buyer_email, ...mail })
    if (!r.ok) { await db.from('orders').update({ receipt_sent_at: null }).eq('id', orderId); claimed = false }
  } catch (e) {
    console.error('receipt failed', e?.message)
    if (claimed) { try { await db.from('orders').update({ receipt_sent_at: null }).eq('id', orderId) } catch { /* ignore */ } }
  }
}

// Tells the administrators a copyright report has arrived. Never throws.
export async function alertAdminOfReport(db, { reportId, productId, reporterName, reporterEmail, relationship, description }) {
  try {
    const to = adminRecipients()
    if (!emailConfigured() || !to.length) { await record(db, { template: 'report_alert', ref: reportId, status: 'skipped', error: 'Email or ADMIN_ALERT_EMAIL is not configured' }); return }
    const { data: product } = await db.from('products').select('title,creator_id').eq('id', productId).maybeSingle()
    const { data: artist } = product?.creator_id ? await db.from('profiles').select('display_name').eq('id', product.creator_id).maybeSingle() : { data: null }
    const mail = reportAlertEmail({ productTitle: product?.title || 'a release', artistName: artist?.display_name || 'unknown', reporterName, reporterEmail, relationship, description })
    await sendEmail(db, { template: 'report_alert', ref: reportId, to, ...mail })
  } catch (e) { console.error('report alert failed', e?.message) }
}

// ---------------------------------------------------------------------------
// Artist applications
// ---------------------------------------------------------------------------
const CRAFT_LABEL = { artist: 'Artist (music)', producer: 'Producer', dj: 'DJ', other: 'Other' }

export function applicationAlertEmail({ stageName, craft, applicantName, applicantEmail, links, bio }) {
  const adminUrl = safeUrl(String(process.env.ADMIN_URL || '').replace(/\/+$/, ''))
  const subject = `New artist application: ${oneLine(stageName, 60)}`
  const linkLines = String(links ?? '').split('\n').map((l) => l.trim()).filter(Boolean)
  const html = wrap(`<h1 style="font-size:20px;margin:0 0 10px">A new artist application is waiting</h1>
<table style="width:100%;border-collapse:collapse;font-size:14px">${row('Stage name', esc(stageName))}${row('Makes', esc(CRAFT_LABEL[craft] || craft))}${row('Account', `${esc(applicantName)} (${esc(applicantEmail)})`)}</table>
<p style="margin:16px 0 6px;color:#6f7168;font-size:12px">Links to their music</p>
<p style="margin:0 0 14px">${linkLines.map(esc).join('<br>')}</p>
${bio ? `<p style="margin:0 0 6px;color:#6f7168;font-size:12px">About them</p><p style="border-left:3px solid #d4ff3f;padding:2px 12px;margin:0 0 18px">${esc(bio).replace(/\n/g, '<br>')}</p>` : ''}
${adminUrl ? `<p><a href="${esc(adminUrl)}" style="background:#191a17;color:#fff;padding:11px 18px;border-radius:3px;text-decoration:none;font-weight:600">Open the admin</a></p>` : ''}
<p style="font-size:12px;color:#6f7168">Open Applications in the admin to approve or turn it down. Check their links first.</p>`)
  const text = ['A new artist application is waiting', '', `Stage name: ${oneLine(stageName, 80)}`, `Makes: ${CRAFT_LABEL[craft] || oneLine(craft, 30)}`, `Account: ${oneLine(applicantName, 80)} (${oneLine(applicantEmail, 200)})`, '', 'Links to their music:', ...linkLines, ...(bio ? ['', 'About them:', String(bio)] : []), '', adminUrl ? `Admin: ${adminUrl}` : 'Open Applications in the admin to approve or turn it down.'].join('\n')
  return { subject, html, text }
}

export function applicationReceivedEmail({ stageName }) {
  const site = safeUrl(siteRoot())
  const subject = 'We received your application to A Thousand Units'
  const html = wrap(`<h1 style="font-size:22px;margin:0 0 10px">Thank you for applying</h1>
<p>We received your application for <b>${esc(stageName)}</b>. Our team will look at your music and reply to you by email. You do not need to do anything else for now.</p>
<p style="font-size:13px;color:#6f7168">Keep an eye on this inbox, and check your spam folder too. If we need anything more, we will ask.</p>
${site ? `<p style="margin:20px 0"><a href="${esc(site)}/" style="color:#191a17">Back to A Thousand Units</a></p>` : ''}`)
  const text = ['Thank you for applying', '', `We received your application for ${oneLine(stageName, 80)}. Our team will look at your music and reply to you by email. You do not need to do anything else for now.`, '', 'Check your spam folder too. If we need anything more, we will ask.', ...(site ? ['', `${site}/`] : [])].join('\n')
  return { subject, html, text }
}

// Tell the administrators, and confirm to the applicant. Neither can throw or block the application.
export async function notifyApplication(db, { applicationId, applicantName, applicantEmail, stageName, craft, links, bio }) {
  try {
    const to = adminRecipients()
    if (to.length) await sendEmail(db, { template: 'application_alert', ref: applicationId, to, ...applicationAlertEmail({ stageName, craft, applicantName, applicantEmail, links, bio }) })
    else await record(db, { template: 'application_alert', ref: applicationId, status: 'skipped', error: 'ADMIN_ALERT_EMAIL is not configured' })
    await sendEmail(db, { template: 'application_received', ref: applicationId, to: applicantEmail, ...applicationReceivedEmail({ stageName }) })
  } catch (e) { console.error('application emails failed', e?.message) }
}
