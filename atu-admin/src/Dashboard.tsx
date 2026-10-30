import { useEffect, useState } from 'react'
import { adminApi, money, when } from './api'
import type { ApiResult } from './api'

type Row = Record<string, any>
type List = { rows: Row[]; page: number; hasMore: boolean }
type Tab = 'overview' | 'people' | 'reports' | 'releases' | 'orders' | 'categories' | 'activity'
const TABS: [Tab, string][] = [['overview', 'Overview'], ['people', 'People'], ['reports', 'Reports'], ['releases', 'Releases'], ['orders', 'Orders'], ['categories', 'Categories'], ['activity', 'Activity']]

type Ask = {
  title: string; intro?: string; confirm: string; danger?: boolean
  field?: { label: string; min: number; type?: 'text' | 'number'; placeholder?: string }
  check?: string
  run: (value: string, checked: boolean) => Promise<ApiResult>
}
type Ctx = { ask: (a: Ask) => void; notify: (m: string) => void; bump: number }

function useData<T>(action: string, params: Record<string, unknown>, deps: unknown[]) {
  const [state, setState] = useState<{ loading: boolean; data?: T; error?: string }>({ loading: true })
  useEffect(() => {
    let off = false
    setState(s => ({ ...s, loading: true, error: undefined }))
    adminApi<T>(action, params).then(r => {
      if (off) return
      if (r.ok) setState({ loading: false, data: r.data })
      else { setState({ loading: false, error: r.error }); if (r.code === 'MFA_REQUIRED') window.dispatchEvent(new Event('atu-reauth')) }
    })
    return () => { off = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, ...deps])
  return state
}

export function Dashboard({ me, onSignOut }: { me: { id: string; email: string }; onSignOut: () => void }) {
  const [tab, setTab] = useState<Tab>('overview')
  const [ask, setAsk] = useState<Ask | null>(null)
  const [toast, setToast] = useState('')
  const [bump, setBump] = useState(0)
  const notify = (m: string) => { setToast(m); window.setTimeout(() => setToast(''), 5000) }
  const ctx: Ctx = { ask: setAsk, notify, bump }
  return <div className="app">
    <header className="top"><div className="brand">A Thousand Units <span>Admin</span></div><div className="who"><span className="muted">{me.email}</span><button className="btn small" onClick={onSignOut}>Sign out</button></div></header>
    <nav className="tabs" aria-label="Sections">{TABS.map(([k, label]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>)}</nav>
    <main className="content">
      {tab === 'overview' && <Overview ctx={ctx} />}
      {tab === 'people' && <People ctx={ctx} />}
      {tab === 'reports' && <Reports ctx={ctx} />}
      {tab === 'releases' && <Releases ctx={ctx} />}
      {tab === 'orders' && <Orders ctx={ctx} />}
      {tab === 'categories' && <Categories ctx={ctx} />}
      {tab === 'activity' && <Activity ctx={ctx} />}
    </main>
    {ask && <Confirm ask={ask} onClose={() => setAsk(null)} onDone={r => { setAsk(null); setBump(b => b + 1); notify(r.auditWarning ? 'Done, but the activity log could not be written.' : 'Done.') }} />}
    {toast && <div className="toast" role="status">{toast}</div>}
  </div>
}

function Confirm({ ask, onClose, onDone }: { ask: Ask; onClose: () => void; onDone: (r: ApiResult) => void }) {
  const [v, setV] = useState(''); const [c, setC] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const haveText = !ask.field || (ask.field.type === 'number' ? v !== '' : v.trim().length >= ask.field.min)
  const ready = haveText && (!ask.check || c)
  const submit = async () => {
    if (!ready || busy) return
    setBusy(true); setErr('')
    const r = await ask.run(v.trim(), c)
    setBusy(false)
    if (r.ok) onDone(r); else setErr(r.error || 'That did not work.')
  }
  return <div className="modal-back" role="dialog" aria-modal="true" aria-label={ask.title}>
    <div className="modal">
      <h2>{ask.title}</h2>
      {ask.intro && <p className="muted">{ask.intro}</p>}
      {ask.field && <><label htmlFor="m-field">{ask.field.label}</label>{ask.field.type === 'number'
        ? <input id="m-field" type="number" min={1} max={99} value={v} onChange={e => setV(e.target.value)} />
        : <textarea id="m-field" rows={3} maxLength={300} placeholder={ask.field.placeholder} value={v} onChange={e => setV(e.target.value)} />}</>}
      {ask.check && <label className="check"><input type="checkbox" checked={c} onChange={e => setC(e.target.checked)} /> {ask.check}</label>}
      {err && <p className="error">{err}</p>}
      <div className="row end"><button className="btn" onClick={onClose}>Cancel</button><button className={`btn ${ask.danger ? 'danger' : 'primary'}`} disabled={!ready || busy} onClick={submit}>{busy ? 'Working...' : ask.confirm}</button></div>
    </div>
  </div>
}

function State({ loading, error }: { loading: boolean; error?: string }) {
  if (loading) return <p className="muted">Loading...</p>
  if (error) return <p className="error">{error}</p>
  return null
}
function Pager({ page, hasMore, set }: { page: number; hasMore: boolean; set: (n: number) => void }) {
  if (page === 0 && !hasMore) return null
  return <div className="row">{page > 0 && <button className="btn small" onClick={() => set(page - 1)}>Previous</button>}<span className="muted">Page {page + 1}</span>{hasMore && <button className="btn small" onClick={() => set(page + 1)}>Next</button>}</div>
}
const Pill = ({ tone, children }: { tone?: 'good' | 'warn' | 'bad'; children: React.ReactNode }) => <span className={`pill ${tone || ''}`}>{children}</span>

function Overview({ ctx }: { ctx: Ctx }) {
  const { data, loading, error } = useData<Row>('overview', {}, [ctx.bump])
  const cards: [string, string, boolean?][] = data ? [
    ['People', String(data.users)], ['Artists', String(data.artists)], ['Artists waiting for verification', String(data.unverifiedArtists), data.unverifiedArtists > 0],
    ['Published releases', String(data.releasesPublished)], ['Removed releases', String(data.releasesRemoved)], ['Open reports', String(data.openReports), data.openReports > 0],
    ['Paid orders', String(data.paidOrders)], ['Units sold', String(data.unitsSold)], ['Gross sales', money(data.grossMinor)], ['Follows', String(data.followers)], ['Active campaigns', String(data.activeCampaigns)]
  ] : []
  return <section><h1>Overview</h1><State loading={loading} error={error} /><div className="cards">{cards.map(([l, v, hot]) => <div key={l} className={`stat ${hot ? 'hot' : ''}`}><span>{l}</span><strong>{v}</strong></div>)}</div></section>
}

function People({ ctx }: { ctx: Ctx }) {
  const [q, setQ] = useState(''); const [role, setRole] = useState(''); const [applied, setApplied] = useState({ q: '', role: '' }); const [page, setPage] = useState(0)
  const { data, loading, error } = useData<List>('users.list', { q: applied.q, role: applied.role, page }, [applied, page, ctx.bump])
  const change = (u: Row, changes: Row, label: string, intro?: string, danger?: boolean) => ctx.ask({ title: `${label}: ${u.display_name}`, intro: intro || u.email, confirm: label, danger, run: () => adminApi('user.update', { userId: u.id, changes }) })
  const feature = (u: Row) => ctx.ask({ title: `Feature ${u.display_name}`, intro: 'Featured artists appear first in Meet the Makers. 1 is the first position.', confirm: 'Feature', field: { label: 'Position (1 to 99)', min: 1, type: 'number' }, run: v => adminApi('user.update', { userId: u.id, changes: { featuredOrder: Number(v) } }) })
  return <section><h1>People</h1>
    <div className="row"><input aria-label="Search people" placeholder="Search name or email" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { setApplied({ q, role }); setPage(0) } }} />
      <select aria-label="Role" value={role} onChange={e => { setRole(e.target.value); setApplied({ q, role: e.target.value }); setPage(0) }}><option value="">All roles</option><option value="fan">Fans</option><option value="artist">Artists</option><option value="admin">Admins</option></select>
      <button className="btn" onClick={() => { setApplied({ q, role }); setPage(0) }}>Search</button></div>
    <State loading={loading} error={error} />
    <div className="scroll"><table><thead><tr><th>Name</th><th>Role</th><th>Releases</th><th>Standing</th><th>Joined</th><th>Actions</th></tr></thead><tbody>
      {data?.rows.map(u => <tr key={u.id}>
        <td><b>{u.display_name}</b><br /><span className="muted">{u.email}</span></td>
        <td>{u.role === 'artist' ? (u.verified_artist ? <Pill tone="good">Verified artist</Pill> : <Pill tone="warn">Artist, not verified</Pill>) : <Pill>{u.role}</Pill>}{u.featured_order ? <Pill>Featured #{u.featured_order}</Pill> : null}{u.hidden_from_makers ? <Pill>Hidden</Pill> : null}</td>
        <td>{u.releases}</td>
        <td>{u.suspended_at ? <Pill tone="bad">Suspended</Pill> : u.strikes > 0 ? <Pill tone="warn">{u.strikes} strike{u.strikes > 1 ? 's' : ''}</Pill> : <span className="muted">Good</span>}</td>
        <td>{when(u.created_at)}</td>
        <td className="actions">{u.role === 'admin' ? <span className="muted">Managed in the database</span> : <>
          {u.role === 'fan' && <button className="btn small" onClick={() => change(u, { role: 'artist' }, 'Make artist')}>Make artist</button>}
          {u.role === 'artist' && !u.verified_artist && <button className="btn small primary" onClick={() => change(u, { verified: true }, 'Verify artist')}>Verify</button>}
          {u.role === 'artist' && u.verified_artist && <button className="btn small" onClick={() => change(u, { verified: false }, 'Remove verification')}>Unverify</button>}
          {u.role === 'artist' && <button className="btn small" onClick={() => feature(u)}>Feature</button>}
          {u.role === 'artist' && u.featured_order && <button className="btn small" onClick={() => change(u, { featuredOrder: null }, 'Remove feature')}>Unfeature</button>}
          {u.role === 'artist' && <button className="btn small" onClick={() => change(u, { hidden: !u.hidden_from_makers }, u.hidden_from_makers ? 'Show in Meet the Makers' : 'Hide from Meet the Makers')}>{u.hidden_from_makers ? 'Show' : 'Hide'}</button>}
          {u.role === 'artist' && (u.suspended_at ? <button className="btn small" onClick={() => change(u, { suspended: false }, 'Lift suspension', 'This also clears their strikes.')}>Lift suspension</button> : <button className="btn small danger" onClick={() => change(u, { suspended: true }, 'Suspend artist', 'They will not be able to publish or upload.', true)}>Suspend</button>)}
          {u.role === 'artist' && <button className="btn small" onClick={() => change(u, { role: 'fan' }, 'Make fan', 'This removes their verification and featuring.', true)}>Make fan</button>}
        </>}</td></tr>)}
    </tbody></table></div>
    {data && !data.rows.length && !loading && <p className="muted">Nobody matches.</p>}
    {data && <Pager page={page} hasMore={data.hasMore} set={setPage} />}
  </section>
}

function Reports({ ctx }: { ctx: Ctx }) {
  const [status, setStatus] = useState('open'); const [page, setPage] = useState(0)
  const { data, loading, error } = useData<List>('reports.list', { status: status === 'all' ? '' : status, page }, [status, page, ctx.bump])
  const takedown = (r: Row) => ctx.ask({ title: 'Take down release', intro: `"${r.product_title}" by ${r.creator_name}. This hides it, blocks downloads and previews, and gives the artist a strike. Three strikes suspend them.`, confirm: 'Take down', danger: true, field: { label: 'Reason (kept in the record)', min: 3 }, run: reason => adminApi('product.takedown', { productId: r.product_id, reason }) })
  const dismiss = (r: Row) => ctx.ask({ title: 'Dismiss report', intro: `Report about "${r.product_title}". The release stays up.`, confirm: 'Dismiss', field: { label: 'Why is this report not valid?', min: 3 }, run: note => adminApi('report.dismiss', { reportId: r.id, note }) })
  return <section><h1>Reports</h1>
    <div className="row"><select aria-label="Report status" value={status} onChange={e => { setStatus(e.target.value); setPage(0) }}><option value="open">Open</option><option value="actioned">Actioned</option><option value="rejected">Dismissed</option><option value="all">All</option></select></div>
    <State loading={loading} error={error} />
    {data?.rows.map(r => <article key={r.id} className="card report">
      <div className="row between"><b>{r.product_title}</b><span><Pill tone={r.status === 'open' ? 'warn' : undefined}>{r.status}</Pill> <Pill tone={r.product_status === 'removed' ? 'bad' : undefined}>release {r.product_status}</Pill></span></div>
      <p className="muted">By {r.creator_name}. Reported {when(r.created_at)} by {r.reporter_name} ({r.reporter_email}), {String(r.relationship).replace('_', ' ')}. Signed: {r.signature}</p>
      <p className="quote">{r.work_description}</p>
      {r.resolution && <p className="muted">Resolution: {r.resolution}</p>}
      {r.status === 'open' && <div className="row"><button className="btn danger" onClick={() => takedown(r)}>Take down release</button><button className="btn" onClick={() => dismiss(r)}>Dismiss</button></div>}
    </article>)}
    {data && !data.rows.length && !loading && <p className="muted">No reports here.</p>}
    {data && <Pager page={page} hasMore={data.hasMore} set={setPage} />}
  </section>
}

function Releases({ ctx }: { ctx: Ctx }) {
  const [q, setQ] = useState(''); const [status, setStatus] = useState(''); const [applied, setApplied] = useState({ q: '', status: '' }); const [page, setPage] = useState(0)
  const { data, loading, error } = useData<List>('products.list', { q: applied.q, status: applied.status, page }, [applied, page, ctx.bump])
  const takedown = (p: Row) => ctx.ask({ title: 'Take down release', intro: `"${p.title}" by ${p.creator_name}. This hides it, blocks downloads and previews, and gives the artist a strike.`, confirm: 'Take down', danger: true, field: { label: 'Reason (kept in the record)', min: 3 }, run: reason => adminApi('product.takedown', { productId: p.id, reason }) })
  const restore = (p: Row) => ctx.ask({ title: 'Restore release', intro: `"${p.title}" will be published again and the artist's strike is reduced by one.`, confirm: 'Restore', field: { label: 'Why is it being restored?', min: 3 }, run: note => adminApi('product.restore', { productId: p.id, note }) })
  return <section><h1>Releases</h1>
    <div className="row"><input aria-label="Search releases" placeholder="Search title or artist" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { setApplied({ q, status }); setPage(0) } }} />
      <select aria-label="Release status" value={status} onChange={e => { setStatus(e.target.value); setApplied({ q, status: e.target.value }); setPage(0) }}><option value="">Any status</option><option value="published">Published</option><option value="draft">Draft</option><option value="archived">Archived</option><option value="removed">Removed</option></select>
      <button className="btn" onClick={() => { setApplied({ q, status }); setPage(0) }}>Search</button></div>
    <State loading={loading} error={error} />
    <div className="scroll"><table><thead><tr><th>Release</th><th>Artist</th><th>Status</th><th>Category</th><th>Price</th><th>Units</th><th>Reports</th><th>Actions</th></tr></thead><tbody>
      {data?.rows.map(p => <tr key={p.id}><td><b>{p.title}</b></td><td>{p.creator_name}</td><td><Pill tone={p.status === 'removed' ? 'bad' : p.status === 'published' ? 'good' : undefined}>{p.status}</Pill></td><td>{String(p.category || '').replace(/_/g, ' ')}</td><td>{p.pricing_mode === 'pay_what_you_want' ? 'Pay what you want' : money(p.price_minor)}</td><td>{p.units_sold}</td><td>{p.open_reports > 0 ? <Pill tone="warn">{p.open_reports} open</Pill> : <span className="muted">None</span>}</td>
        <td className="actions">{p.status === 'removed' ? <button className="btn small" onClick={() => restore(p)}>Restore</button> : <button className="btn small danger" onClick={() => takedown(p)}>Take down</button>}</td></tr>)}
    </tbody></table></div>
    {data && !data.rows.length && !loading && <p className="muted">No releases match.</p>}
    {data && <Pager page={page} hasMore={data.hasMore} set={setPage} />}
  </section>
}

function Orders({ ctx }: { ctx: Ctx }) {
  const [q, setQ] = useState(''); const [status, setStatus] = useState(''); const [applied, setApplied] = useState({ q: '', status: '' }); const [page, setPage] = useState(0)
  const { data, loading, error } = useData<List>('orders.list', { q: applied.q, status: applied.status, page }, [applied, page, ctx.bump])
  const refund = (o: Row) => ctx.ask({ title: 'Mark order as refunded', intro: `${money(o.amount_minor)} from ${o.buyer_email} for "${o.product_title}". This only updates our records. It does not send money.`, confirm: 'Mark refunded', danger: true, check: 'I have already refunded this payment in the Paystack dashboard.', field: { label: 'Note (kept in the record)', min: 3 }, run: (note, checked) => adminApi('order.markRefunded', { orderId: o.id, note, refundedInPaystack: checked }) })
  return <section><h1>Orders</h1>
    <p className="notice">Buyer email addresses are personal data. Every time you open this page, it is recorded in the activity log.</p>
    <div className="row"><input aria-label="Search orders" placeholder="Search email, reference or release" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { setApplied({ q, status }); setPage(0) } }} />
      <select aria-label="Order status" value={status} onChange={e => { setStatus(e.target.value); setApplied({ q, status: e.target.value }); setPage(0) }}><option value="">Any status</option><option value="paid">Paid</option><option value="pending">Pending</option><option value="refunded">Refunded</option><option value="disputed">Disputed</option><option value="verification_failed">Verification failed</option><option value="payment_initialization_failed">Could not start</option></select>
      <button className="btn" onClick={() => { setApplied({ q, status }); setPage(0) }}>Search</button></div>
    <State loading={loading} error={error} />
    <div className="scroll"><table><thead><tr><th>Date</th><th>Buyer</th><th>Release</th><th>Amount</th><th>Fee</th><th>Status</th><th>Reference</th><th>Actions</th></tr></thead><tbody>
      {data?.rows.map(o => <tr key={o.id}><td>{when(o.paid_at || o.created_at)}</td><td>{o.buyer_email}</td><td><b>{o.product_title}</b><br /><span className="muted">{o.creator_name}</span></td><td>{money(o.amount_minor)}{o.quantity > 1 ? ` (${o.quantity} units)` : ''}</td><td>{money(o.platform_fee_minor)}</td><td><Pill tone={o.status === 'paid' ? 'good' : o.status === 'refunded' || o.status === 'disputed' ? 'warn' : undefined}>{o.status}</Pill></td><td><code>{o.payment_reference}</code></td>
        <td className="actions">{o.status === 'paid' && <button className="btn small danger" onClick={() => refund(o)}>Mark refunded</button>}</td></tr>)}
    </tbody></table></div>
    {data && !data.rows.length && !loading && <p className="muted">No orders match.</p>}
    {data && <Pager page={page} hasMore={data.hasMore} set={setPage} />}
  </section>
}

function Categories({ ctx }: { ctx: Ctx }) {
  const { data, loading, error } = useData<Row[]>('categories.list', {}, [ctx.bump])
  const toggle = (c: Row) => ctx.ask({ title: `${c.enabled ? 'Close' : 'Open'} ${c.label}`, intro: c.enabled ? 'Artists will no longer be able to create new releases here.' : c.fulfillment === 'physical' ? 'Physical items cannot be published yet even when a category is open.' : 'Artists will be able to create releases in this category.', confirm: c.enabled ? 'Close category' : 'Open category', danger: c.enabled, run: () => adminApi('category.set', { slug: c.slug, enabled: !c.enabled }) })
  return <section><h1>Categories</h1><State loading={loading} error={error} />
    <div className="scroll"><table><thead><tr><th>Group</th><th>Category</th><th>Type</th><th>Status</th><th>Actions</th></tr></thead><tbody>
      {data?.map(c => <tr key={c.slug}><td>{c.group_name}</td><td><b>{c.label}</b></td><td>{c.fulfillment}</td><td>{c.enabled ? <Pill tone="good">Open</Pill> : <Pill>Closed</Pill>}</td><td className="actions"><button className="btn small" onClick={() => toggle(c)}>{c.enabled ? 'Close' : 'Open'}</button></td></tr>)}
    </tbody></table></div></section>
}

function Activity({ ctx }: { ctx: Ctx }) {
  const [page, setPage] = useState(0)
  const { data, loading, error } = useData<List>('audit.list', { page }, [page, ctx.bump])
  return <section><h1>Activity</h1><p className="muted">Everything done in this admin, newest first.</p><State loading={loading} error={error} />
    <div className="scroll"><table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Details</th></tr></thead><tbody>
      {data?.rows.map(a => <tr key={a.id}><td>{when(a.created_at)}</td><td>{a.admin_name || a.admin_id}</td><td><code>{a.action}</code></td><td>{a.target_type}{a.target_id ? ` ${String(a.target_id).slice(0, 8)}` : ''}</td><td><code className="wrap">{JSON.stringify(a.details)}</code></td></tr>)}
    </tbody></table></div>
    {data && !data.rows.length && !loading && <p className="muted">Nothing yet.</p>}
    {data && <Pager page={page} hasMore={data.hasMore} set={setPage} />}
  </section>
}
