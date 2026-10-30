import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { adminApi } from './api'
import { Dashboard } from './Dashboard'

type Stage = 'loading' | 'signin' | 'denied' | 'enroll' | 'challenge' | 'ready'
const IDLE_MINUTES = 20

export function App() {
  const [stage, setStage] = useState<Stage>('loading')
  const [me, setMe] = useState<{ id: string; email: string } | null>(null)
  const [message, setMessage] = useState('')

  const evaluate = useCallback(async () => {
    if (!supabase) return setStage('signin')
    const { data } = await supabase.auth.getSession()
    if (!data.session) { setMe(null); return setStage('signin') }
    // First: is this account an administrator at all? If not, stop here, before any two-factor setup.
    const who = await adminApi<{ id: string; email: string }>('whoami')
    if (!who.ok) { setMessage(who.error || 'This account is not an administrator'); return setStage('denied') }
    setMe(who.data!)
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (aal?.currentLevel === 'aal2') return setStage('ready')
    setStage(aal?.nextLevel === 'aal2' ? 'challenge' : 'enroll')
  }, [])

  useEffect(() => {
    evaluate()
    if (!supabase) return
    const { data: sub } = supabase.auth.onAuthStateChange(() => { evaluate() })
    const again = () => evaluate()
    window.addEventListener('atu-reauth', again)
    return () => { sub.subscription.unsubscribe(); window.removeEventListener('atu-reauth', again) }
  }, [evaluate])

  // Sign out after a stretch of no activity, in case the screen is left open.
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (stage !== 'ready' || !supabase) return
    const reset = () => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => { supabase!.auth.signOut(); setMessage('You were signed out after a period of no activity.') }, IDLE_MINUTES * 60 * 1000) }
    const events = ['mousemove', 'keydown', 'click', 'scroll']
    events.forEach(e => window.addEventListener(e, reset)); reset()
    return () => { events.forEach(e => window.removeEventListener(e, reset)); window.clearTimeout(timer.current) }
  }, [stage])

  const signOut = async () => { await supabase?.auth.signOut(); setMessage(''); setStage('signin') }

  if (!supabase) return <Shell><h1>Not configured</h1><p className="muted">Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your hosting settings, then redeploy.</p></Shell>
  if (stage === 'loading') return <Shell><p className="muted">Loading...</p></Shell>
  if (stage === 'signin') return <Shell><SignIn note={message} /></Shell>
  if (stage === 'denied') return <Shell><h1>Not allowed</h1><p className="error">{message}</p><button className="btn" onClick={signOut}>Sign out</button></Shell>
  if (stage === 'enroll') return <Shell><Enroll onDone={evaluate} onCancel={signOut} /></Shell>
  if (stage === 'challenge') return <Shell><Challenge onDone={evaluate} onCancel={signOut} /></Shell>
  return <Dashboard me={me!} onSignOut={signOut} />
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="shell"><div className="card narrow"><div className="brand">A Thousand Units <span>Admin</span></div>{children}</div></main>
}

function SignIn({ note }: { note: string }) {
  const [email, setEmail] = useState(''); const [pw, setPw] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const go = async () => {
    if (busy || !supabase) return
    setBusy(true); setErr('')
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw })
    setBusy(false)
    if (error) setErr('Those details did not work.')
  }
  return <>
    <h1>Sign in</h1>
    <p className="muted">Administrators only.</p>
    {note && <p className="notice">{note}</p>}
    <label htmlFor="a-email">Email</label><input id="a-email" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} />
    <label htmlFor="a-pw">Password</label><input id="a-pw" type="password" autoComplete="current-password" value={pw} onChange={e => setPw(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') go() }} />
    {err && <p className="error">{err}</p>}
    <button className="btn primary wide" disabled={busy} onClick={go}>{busy ? 'Signing in...' : 'Sign in'}</button>
  </>
}

function Enroll({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [qr, setQr] = useState(''); const [secret, setSecret] = useState(''); const [factorId, setFactorId] = useState('')
  const [code, setCode] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  useEffect(() => {
    let off = false
    ;(async () => {
      if (!supabase) return
      const { data: list } = await supabase.auth.mfa.listFactors()
      for (const f of list?.all ?? []) if (f.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: f.id })
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Admin ${Math.random().toString(36).slice(2, 8)}` })
      if (off) return
      if (error || !data) { setErr(error?.message || 'Could not start two-factor setup. Check that multi-factor authentication is enabled in Supabase.'); return }
      setFactorId(data.id); setQr(data.totp.qr_code); setSecret(data.totp.secret)
    })()
    return () => { off = true }
  }, [])
  const verify = async () => {
    if (busy || !supabase) return
    setBusy(true); setErr('')
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() })
    setBusy(false)
    if (error) setErr('That code did not work. Check your phone clock and try the next code.'); else onDone()
  }
  return <>
    <h1>Set up two-factor</h1>
    <p className="muted">Scan this code with an authenticator app such as Google Authenticator, 1Password or Authy. You will need a code from it every time you sign in.</p>
    {qr ? <img className="qr" src={qr} alt="Two-factor setup code" /> : !err && <p className="muted">Preparing...</p>}
    {secret && <p className="muted">Can not scan? Enter this key instead: <code>{secret}</code></p>}
    <label htmlFor="a-code">6 digit code</label><input id="a-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} onKeyDown={e => { if (e.key === 'Enter') verify() }} />
    {err && <p className="error">{err}</p>}
    <button className="btn primary wide" disabled={busy || code.length !== 6 || !factorId} onClick={verify}>Turn on two-factor</button>
    <button className="link" onClick={onCancel}>Sign out</button>
  </>
}

function Challenge({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [code, setCode] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const verify = async () => {
    if (busy || !supabase) return
    setBusy(true); setErr('')
    const { data: list } = await supabase.auth.mfa.listFactors()
    const factor = list?.totp?.[0]
    if (!factor) { setBusy(false); return setErr('No authenticator is set up for this account.') }
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.trim() })
    setBusy(false)
    if (error) setErr('That code did not work. Try the next one.'); else onDone()
  }
  return <>
    <h1>Enter your code</h1>
    <p className="muted">Open your authenticator app and enter the 6 digit code.</p>
    <label htmlFor="a-code2">6 digit code</label><input id="a-code2" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} onKeyDown={e => { if (e.key === 'Enter') verify() }} />
    {err && <p className="error">{err}</p>}
    <button className="btn primary wide" disabled={busy || code.length !== 6} onClick={verify}>Continue</button>
    <button className="link" onClick={onCancel}>Sign out</button>
  </>
}
