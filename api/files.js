// One serverless function that serves several endpoints (the file endpoints and the artist application), so the project stays under Vercel's 12 function limit on the free plan.
// The web addresses do not change: vercel.json rewrites /api/register-audio (and the others) to this function.
//
// To add another endpoint like these, put its handler in api/_handlers/, add it to ROUTES below, and add a matching
// rewrite in vercel.json. Run `node scripts/check-functions.mjs` to confirm everything lines up.
// The payment webhook is NOT in here on purpose: it needs raw request bodies, which is a per-function setting.
import registerAudio from './_handlers/register-audio.js'
import removeAudio from './_handlers/remove-audio.js'
import registerPreview from './_handlers/register-preview.js'
import removePreview from './_handlers/remove-preview.js'
import registerArtwork from './_handlers/register-artwork.js'
import download from './_handlers/download.js'
import previews from './_handlers/previews.js'
import apply from './_handlers/apply.js'
import config from './_handlers/config.js'

export const ROUTES = {
  'register-audio': registerAudio,
  'remove-audio': removeAudio,
  'register-preview': registerPreview,
  'remove-preview': removePreview,
  'register-artwork': registerArtwork,
  'download': download,
  'previews': previews,
  'apply': apply,
  'config': config
}
export const ROUTE_NAMES = Object.keys(ROUTES)

function routeOf(req) {
  const q = req.query?.route
  if (typeof q === 'string') return q
  if (Array.isArray(q)) return ''
  try {
    const url = new URL(req.url || '', 'http://localhost')
    const all = url.searchParams.getAll('route')
    if (all.length === 1) return all[0]
    if (all.length > 1) return ''
    return url.pathname.split('/').filter(Boolean).pop() || ''     // fall back to the original path if the platform kept it
  } catch { return '' }
}

export default async function handler(req, res) {
  const name = routeOf(req)
  const fn = Object.prototype.hasOwnProperty.call(ROUTES, name) ? ROUTES[name] : null
  if (!fn) return res.status(404).json({ error: 'Not found' })
  return fn(req, res)
}
