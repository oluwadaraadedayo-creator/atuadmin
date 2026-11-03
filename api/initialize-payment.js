import { applyCors, adminClient, userFromRequest, isUuid, resolveAmount, splitFor, platformFeePercent } from './_lib.js'

export default async function handler(req, res) {
  if (applyCors(req, res)) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const secret = process.env.PAYSTACK_SECRET_KEY
    if (!secret) return res.status(503).json({ error: 'Payments are not configured' })
    const db = adminClient()
    const user = await userFromRequest(req, db)
    if (!user || !user.email) return res.status(401).json({ error: 'Please sign in to buy' })

    const { productId, amount, quantity } = req.body || {}
    if (!isUuid(productId)) return res.status(400).json({ error: 'A valid release is required' })

    const { data: product } = await db.from('products')
      .select('id,title,price_minor,currency,status,creator_id,pricing_mode,min_price_minor')
      .eq('id', productId).eq('status', 'published').single()
    if (!product) return res.status(404).json({ error: 'Release not found or unavailable' })
    if (product.creator_id === user.id) return res.status(400).json({ error: 'You cannot buy your own release' })

    const { data: owned } = await db.from('orders').select('id').eq('buyer_id', user.id).eq('product_id', product.id).eq('status', 'paid').limit(1)
    if (owned?.length) return res.status(409).json({ error: 'You already own this release' })

    const priced = resolveAmount(product, amount, quantity)
    if (priced.error) return res.status(priced.status).json({ error: priced.error })

    const { data: payout } = await db.from('artist_payouts').select('subaccount_code').eq('profile_id', product.creator_id).maybeSingle()
    if (!payout && process.env.ALLOW_UNSPLIT_SALES !== 'true') {
      return res.status(409).json({ error: 'This artist has not set up payouts yet' })
    }
    const split = splitFor({
      amountMinor: priced.amountMinor, subaccountCode: payout?.subaccount_code,
      feePercent: platformFeePercent().value, bearer: process.env.PAYSTACK_FEE_BEARER
    })

    const reference = `atu_${crypto.randomUUID()}`
    const { data: order, error: orderError } = await db.from('orders').insert({
      buyer_id: user.id, buyer_email: user.email.toLowerCase(), product_id: product.id, creator_id: product.creator_id,
      amount_minor: priced.amountMinor, quantity: priced.quantity, currency: product.currency || 'NGN', payment_provider: 'paystack',
      payment_reference: reference, status: 'pending', platform_fee_minor: split.fee, subaccount_code: payout?.subaccount_code ?? null
    }).select('id').single()
    if (orderError || !order) return res.status(500).json({ error: 'Could not create order' })

    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: user.email.toLowerCase(), amount: String(priced.amountMinor), currency: product.currency || 'NGN', reference,
        callback_url: process.env.PAYSTACK_CALLBACK_URL, metadata: { order_id: order.id, product_id: product.id, quantity: priced.quantity }, ...split.extra
      })
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok || !payload?.status || !payload?.data?.authorization_url) {
      console.error('paystack init failed', response.status, JSON.stringify(payload))
      await db.from('orders').update({ status: 'payment_initialization_failed' }).eq('id', order.id)
      return res.status(502).json({ error: 'Payment provider could not initialise checkout' })
    }
    return res.status(200).json({ authorizationUrl: payload.data.authorization_url, reference })
  } catch (error) {
    console.error('initialize-payment failed', error)
    return res.status(500).json({ error: 'Unable to initialise payment' })
  }
}
