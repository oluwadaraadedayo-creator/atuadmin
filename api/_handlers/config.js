import { applyCors, platformFeePercent, paystackMode } from '../_lib.js'

// A read-only look at the money settings the server is really using, so you can check them without making a payment.
// Nothing secret is returned: the fee, where it came from, and whether the Paystack key is a test or a live one.
export default async function handler(req, res) {
  if (applyCors(req, res)) return
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const fee = platformFeePercent()
  // The business that collects payments, shown to buyers at checkout. Plain text only, so nothing odd can be injected into a page.
  const chargedBy = String(process.env.CHARGED_BY_NAME || '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60)
  res.setHeader('Cache-Control', 'no-store')
  return res.status(200).json({ feePercent: fee.value, feeSource: fee.source, paystackMode: paystackMode(), chargedBy })
}
