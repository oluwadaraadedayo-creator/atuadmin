// Email for the admin app: only the notices sent when an application is decided.
// Provider: Resend (https://resend.com). To use a different provider, replace deliver() and nothing else.
// Needs three settings in this project on Vercel: RESEND_API_KEY, EMAIL_FROM and SITE_URL (your public site address).
// Sending never blocks a decision. If email is not set up, the decision still happens and the log says "skipped".

const RESEND_URL = 'https://api.resend.com/emails'
export const emailConfigured = () => Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM)
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
export const oneLine = (s, max = 150) => String(s ?? '').replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
const EMAIL = /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/
const validEmails = (list) => (Array.isArray(list) ? list : [list]).map((x) => String(x ?? '').trim()).filter((x) => EMAIL.test(x) && x.length <= 200).slice(0, 5)
const safeUrl = (u) => (/^https?:\/\//i.test(u) ? u : '')
const siteRoot = () => safeUrl(String(process.env.SITE_URL || '').replace(/\/+$/, ''))

async function deliver({ to, subject, html, text }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Number(process.env.EMAIL_TIMEOUT_MS) || 5000)
  try {
    const body = { from: process.env.EMAIL_FROM, to, subject, html, text }
    if (process.env.EMAIL_REPLY_TO) body.reply_to = process.env.EMAIL_REPLY_TO
    const res = await fetch(RESEND_URL, { method: 'POST', signal: controller.signal, headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const payload = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: oneLine(payload?.message || payload?.name || `Provider returned ${res.status}`, 200) }
    return { ok: true, id: payload?.id ? String(payload.id) : null }
  } catch (e) {
    return { ok: false, error: e?.name === 'AbortError' ? 'The email provider took too long to answer' : oneLine(e?.message || 'Could not reach the email provider', 200) }
  } finally { clearTimeout(timer) }
}
async function record(db, entry) { try { await db.from('email_log').insert(entry) } catch { /* the log is best effort */ } }

export async function sendEmail(db, { template, ref, to, subject, html, text }) {
  try {
    const recipients = validEmails(to)
    if (!emailConfigured()) { await record(db, { template, ref: ref ?? null, status: 'skipped', error: 'Email is not configured in the admin project' }); return { ok: false, skipped: true } }
    if (!recipients.length) { await record(db, { template, ref: ref ?? null, status: 'failed', error: 'No valid recipient' }); return { ok: false, error: 'No valid recipient' } }
    const r = await deliver({ to: recipients, subject: oneLine(subject, 200), html, text })
    await record(db, { template, ref: ref ?? null, status: r.ok ? 'sent' : 'failed', provider_id: r.id ?? null, error: r.ok ? null : r.error })
    if (!r.ok) console.error('email failed', template, r.error)
    return r
  } catch (e) { console.error('sendEmail crashed', template, e?.message); return { ok: false, error: 'Unexpected email error' } }
}

const wrap = (inner) => `<div style="font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;max-width:540px;margin:0 auto;padding:24px;color:#191a17;line-height:1.55">
<p style="font-size:12px;letter-spacing:.12em;color:#6f7168;margin:0 0 18px">A THOUSAND UNITS</p>${inner}</div>`

export function applicationApprovedEmail({ stageName, note }) {
  const site = siteRoot()
  const subject = 'You are approved to sell on A Thousand Units'
  const html = wrap(`<h1 style="font-size:22px;margin:0 0 10px">Welcome, ${esc(stageName)}</h1>
<p>Your application is approved and your account is now a verified artist account.</p>
${note ? `<p style="border-left:3px solid #d4ff3f;padding:2px 12px;margin:14px 0">${esc(note).replace(/\n/g, '<br>')}</p>` : ''}
<p style="margin:16px 0 6px"><b>Your next steps</b></p>
<p style="margin:0">Sign in and open <b>Creator studio</b> from the menu at the top. Accept the uploader terms, create your first release, add your audio, artwork and a short preview, and connect your bank account under Payouts so you can be paid.</p>
${site ? `<p style="margin:20px 0"><a href="${esc(site)}/" style="background:#191a17;color:#fff;padding:11px 18px;border-radius:3px;text-decoration:none;font-weight:600">Open A Thousand Units</a></p>` : ''}
<p style="font-size:12px;color:#6f7168">You may need to sign out and back in before the studio appears.</p>`)
  const text = [`Welcome, ${oneLine(stageName, 80)}`, '', 'Your application is approved and your account is now a verified artist account.', ...(note ? ['', String(note)] : []), '', 'Your next steps: sign in and open Creator studio from the menu at the top. Accept the uploader terms, create your first release, add your audio, artwork and a short preview, and connect your bank account under Payouts so you can be paid.', ...(site ? ['', `${site}/`] : []), '', 'You may need to sign out and back in before the studio appears.'].join('\n')
  return { subject, html, text }
}

export function applicationRejectedEmail({ stageName, note }) {
  const subject = 'About your application to A Thousand Units'
  const html = wrap(`<h1 style="font-size:22px;margin:0 0 10px">Thank you for applying</h1>
<p>We looked at the application for <b>${esc(stageName)}</b> and we are not able to approve it right now.</p>
<p style="border-left:3px solid #d4ff3f;padding:2px 12px;margin:14px 0">${esc(note).replace(/\n/g, '<br>')}</p>
<p style="font-size:13px;color:#6f7168">You are welcome to apply again once you have looked at this. Your account is still active and you can keep buying and following artists.</p>`)
  const text = ['Thank you for applying', '', `We looked at the application for ${oneLine(stageName, 80)} and we are not able to approve it right now.`, '', String(note), '', 'You are welcome to apply again once you have looked at this. Your account is still active and you can keep buying and following artists.'].join('\n')
  return { subject, html, text }
}

// Tells the applicant the outcome. Never throws. Returns true only if the provider accepted the email.
export async function sendDecisionEmail(db, { applicationId, to, decision, stageName, note }) {
  const mail = decision === 'approve' ? applicationApprovedEmail({ stageName, note }) : applicationRejectedEmail({ stageName, note })
  const r = await sendEmail(db, { template: decision === 'approve' ? 'application_approved' : 'application_rejected', ref: applicationId, to, ...mail })
  return r.ok === true
}
