import { applyCors, adminClient, userFromRequest, platformFeePercent } from './_lib.js'

// Registers an artist's bank account with Paystack so sales settle straight to them.
// The account number goes to Paystack only. We keep the subaccount code and the last 4 digits.
export default async function handler(req, res) {
  if (applyCors(req, res)) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const secret = process.env.PAYSTACK_SECRET_KEY
    if (!secret) return res.status(503).json({ error: 'Payments are not configured' })
    const db = adminClient()
    const user = await userFromRequest(req, db)
    if (!user) return res.status(401).json({ error: 'Please sign in' })

    const { data: profile } = await db.from('profiles').select('id,display_name,role,verified_artist').eq('id', user.id).single()
    if (!profile || profile.role !== 'artist' || !profile.verified_artist) return res.status(403).json({ error: 'Only verified artists can set up payouts' })
    const { data: existing } = await db.from('artist_payouts').select('profile_id').eq('profile_id', user.id).maybeSingle()
    if (existing) return res.status(409).json({ error: 'A payout account is already set. Contact support to change it.' })

    const { bankCode, accountNumber } = req.body || {}
    if (!/^\d{3,6}$/.test(String(bankCode || '')) || !/^\d{10}$/.test(String(accountNumber || ''))) {
      return res.status(400).json({ error: 'Choose a bank and enter a 10 digit account number' })
    }
    const headers = { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }
    const resolved = await fetch(`https://api.paystack.co/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`, { headers })
    const resolvedBody = await resolved.json().catch(() => null)
    if (!resolved.ok || !resolvedBody?.data?.account_name) return res.status(422).json({ error: 'We could not verify that account. Check the bank and number.' })

    const pct = platformFeePercent().value
    const created = await fetch('https://api.paystack.co/subaccount', {
      method: 'POST', headers,
      body: JSON.stringify({ business_name: profile.display_name, settlement_bank: bankCode, account_number: accountNumber, percentage_charge: pct })
    })
    const createdBody = await created.json().catch(() => null)
    if (!created.ok || !createdBody?.data?.subaccount_code) {
      console.error('subaccount create failed', created.status, createdBody?.message)
      return res.status(502).json({ error: 'Paystack could not create the payout account' })
    }
    const { error } = await db.from('artist_payouts').insert({
      profile_id: user.id, subaccount_code: createdBody.data.subaccount_code,
      bank_name: createdBody.data.settlement_bank || null, account_name: resolvedBody.data.account_name, account_last4: accountNumber.slice(-4)
    })
    if (error) { console.error('payout record failed', error.code); return res.status(500).json({ error: 'Payout account created but could not be saved. Contact support.' }) }
    return res.status(200).json({ ok: true, accountName: resolvedBody.data.account_name, last4: accountNumber.slice(-4) })
  } catch (error) {
    console.error('create-subaccount failed', error)
    return res.status(500).json({ error: 'Could not set up payouts' })
  }
}
