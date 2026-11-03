import React, { useContext, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowDownRight, ArrowLeft, ArrowRight, ArrowUpRight, AudioLines, BadgeCheck, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Disc3, Download, Headphones, Heart, Library, LockKeyhole, LogIn, Menu, Music2, Plus, Search, ShieldCheck, ShoppingBag, SlidersHorizontal, Sparkles, TrendingUp, Upload, Wallet, X } from 'lucide-react'
import './styles.css'
import { supabase } from './supabase'
import type { Session } from '@supabase/supabase-js'
import { API, apiCall, CATEGORIES_FALLBACK, groupOf, mapProduct, money, priceLabel, PRODUCT_SELECT } from './lib'
import type { CampaignProgress, Category, Maker, Profile, Release } from './lib'
import { asset } from './asset'
import { AuthPage, RecoveryDialog } from './auth'
import { ArtistStudio } from './studio'
import { CampaignCard } from './campaign'
import { OwnedFiles } from './files'
import { ReportDialog } from './report'
import { ArtistPage } from './artistPage'
import { ApplyPage } from './apply'
import { PreviewPlayer } from './previews'
import { InfoPage } from './info'
import type { InfoKind } from './info'
import { contactEmail } from './site'

type Page = 'explore'|'detail'|'checkout'|'library'|'artist'|'admin'|'signin'|'artistPage'|'info'
const ArtistNav = React.createContext<(id:string)=>void>(()=>{})
const EMPTY:Release={id:'',title:'',artist:'',artistId:'',type:'Album',price:0,image:'',description:'',tracks:[],date:''}
const art = {
  // Use image files that are actually present in public/images. The former
  // unsplash-*.jpg placeholders were not included in the repository and returned 404s.
  cover1:asset('/images/album-afroskankin.jpg'),
  cover2:asset('/images/album-african-gangsta.jpg'),
  cover3:asset('/images/album-ipseity-new.png'),
  cover4:asset('/images/album-jagaban-times.jpg'),
  cover5:asset('/images/album-best-ever.jpg'),
  cover6:asset('/images/album-no-sign-of-weakness.jpg'),
  cover7:asset('/images/album-oriade.jpg'),
  cover8:asset('/images/album-west-african-goat-new.png'),
  artist1:asset('/images/album-afroskankin.jpg'),
  artist2:asset('/images/album-ipseity-new.png'),
  artist3:asset('/images/album-ipseity-new.png'),
  artist4:asset('/images/album-west-african-goat-new.png')
}
function readLocal<T>(key:string,fallback:T):T { try { const s=localStorage.getItem(key); return s?JSON.parse(s) as T:fallback } catch { return fallback } }
function writeLocal<T>(key:string,value:T):void { try { localStorage.setItem(key,JSON.stringify(value)) } catch { /* Storage can be disabled or full; keep the app usable in memory. */ } }
function App(){
 const [page,setPage]=useState<Page>('explore'); const [releases,setReleases]=useState<Release[]>([]); const [selected,setSelected]=useState<Release>(EMPTY); const [search,setSearch]=useState(''); const [category,setCategory]=useState('All'); const [slide,setSlide]=useState(0); const [menuOpen,setMenuOpen]=useState(false); const [showSearch,setShowSearch]=useState(false); const [toast,setToast]=useState(''); const [checkoutEmail,setCheckoutEmail]=useState(''); const [pendingOrder,setPendingOrder]=useState(false); const [draft,setDraft]=useState({title:'',artist:'',type:'EP',price:'3500',description:'',tracks:'',image:''}); const [draftMode,setDraftMode]=useState<'new'|'edit'>('new'); const [editingId,setEditingId]=useState<string|null>(null); const [tab,setTab]=useState<'overview'|'releases'|'orders'>('overview'); const [showDemoInfo,setShowDemoInfo]=useState(false)
 const [session,setSession]=useState<Session|null>(null)
 const [profile,setProfile]=useState<Profile|null>(null)
 const [owned,setOwned]=useState<Release[]>([])
 const [libVersion,setLibVersion]=useState(0)
 const [paying,setPaying]=useState(false)
 const [chargedBy,setChargedBy]=useState('')
 useEffect(()=>{ if(page!=='checkout'||chargedBy)return; apiCall<{chargedBy?:string}>('/api/config',{method:'GET'}).then(r=>{ if(r.ok&&typeof r.data?.chargedBy==='string')setChargedBy(r.data.chargedBy) }) },[page])
 const [payAmount,setPayAmount]=useState('')
 const [quantity,setQuantity]=useState(1)
 const [campaign,setCampaign]=useState<CampaignProgress|null>(null)
 const [authNote,setAuthNote]=useState('')
 const [afterAuth,setAfterAuth]=useState<Page>('explore')
 const [makers,setMakers]=useState<Maker[]>([])
 const [follows,setFollows]=useState<string[]>([])
 const [reporting,setReporting]=useState(false)
 const [artistId,setArtistId]=useState('')
 const [infoKind,setInfoKind]=useState<InfoKind>('terms')
 const [recovery,setRecovery]=useState(false)
 const [cats,setCats]=useState<Category[]>(CATEGORIES_FALLBACK)
 const [catGroup,setCatGroup]=useState<'all'|'music'|'fashion'|'others'>('all')
 const [catSlug,setCatSlug]=useState('all')
 useEffect(()=>{
  if(!supabase)return
  supabase.from('categories').select('*').order('sort').then(({data})=>{ if(Array.isArray(data)&&data.length)setCats(data as Category[]) })
 },[])
 useEffect(()=>{
  const apply=()=>{
   const m=window.location.hash.match(/^#\/artist\/([0-9a-f-]{36})$/i)
   setMenuOpen(false)
   const info=window.location.hash.match(/^#\/(terms|privacy|refunds|about|help)$/)
   if(m){setArtistId(m[1].toLowerCase());setPage('artistPage');window.scrollTo({top:0})}
   else if(info){setInfoKind(info[1] as InfoKind);setPage('info');window.scrollTo({top:0})}
   else setPage(p=>p==='artistPage'||p==='info'?'explore':p)
  }
  apply()
  window.addEventListener('hashchange',apply)
  return()=>window.removeEventListener('hashchange',apply)
 },[])
 const openArtist=(id:string)=>{ if(id)window.location.hash=`#/artist/${id}` }
 const [acctOpen,setAcctOpen]=useState(false)
 useEffect(()=>{
  if(!acctOpen)return
  const close=(e:MouseEvent)=>{ if(!(e.target as HTMLElement).closest('.acct'))setAcctOpen(false) }
  document.addEventListener('click',close)
  return()=>document.removeEventListener('click',close)
 },[acctOpen])
 const signOut=async()=>{
  setAcctOpen(false)
  await supabase?.auth.signOut({scope:'local'})
  setSession(null);setProfile(null);setOwned([]);setFollows([])
  setToast('Signed out.');go('explore')
 }
 const [artistFollowers,setArtistFollowers]=useState(0)
 useEffect(()=>{
  if(!supabase)return
  supabase.rpc('makers_list',{p_limit:12}).then(({data})=>{ if(Array.isArray(data))setMakers(data as Maker[]) })
 },[])
 useEffect(()=>{
  if(!supabase||!session){setFollows([]);return}
  supabase.from('follows').select('creator_id').eq('follower_id',session.user.id).then(({data})=>setFollows((data||[]).map((r:any)=>r.creator_id)))
 },[session?.user.id])
 useEffect(()=>{
  setArtistFollowers(0)
  if(!supabase||page!=='detail'||!selected.artistId)return
  supabase.rpc('follower_counts',{p_ids:[selected.artistId]}).then(({data})=>{ if(Array.isArray(data)&&data[0])setArtistFollowers(data[0].followers) })
 },[selected.artistId,page])
 const toggleFollow=async(creatorId:string)=>{
  if(!supabase||!creatorId)return
  if(!session){setAfterAuth(page);setAuthNote('Sign in to follow artists.');go('signin');return}
  if(creatorId===session.user.id){setToast('You cannot follow yourself.');return}
  const on=follows.includes(creatorId),delta=on?-1:1
  setFollows(f=>on?f.filter(x=>x!==creatorId):[...f,creatorId])
  setMakers(m=>m.map(x=>x.id===creatorId?{...x,followers:Math.max(0,x.followers+delta)}:x))
  if(selected.artistId===creatorId)setArtistFollowers(n=>Math.max(0,n+delta))
  const {error}=on?await supabase.from('follows').delete().eq('follower_id',session.user.id).eq('creator_id',creatorId):await supabase.from('follows').insert({follower_id:session.user.id,creator_id:creatorId})
  if(error){
   setFollows(f=>on?[...f,creatorId]:f.filter(x=>x!==creatorId))
   setMakers(m=>m.map(x=>x.id===creatorId?{...x,followers:Math.max(0,x.followers-delta)}:x))
   if(selected.artistId===creatorId)setArtistFollowers(n=>Math.max(0,n-delta))
   setToast('Could not update your follow. Try again.')
  }
 }
 useEffect(()=>{
  if(!supabase)return
  supabase.from('products').select(PRODUCT_SELECT).eq('status','published').order('published_at',{ascending:false}).then(({data,error})=>{ if(!error&&data)setReleases(data.map(mapProduct)) })
 },[])
 useEffect(()=>{
  if(!supabase)return
  supabase.auth.getSession().then(({data})=>setSession(data.session))
  const {data:sub}=supabase.auth.onAuthStateChange((e,s)=>{setSession(s);if(e==='PASSWORD_RECOVERY')setRecovery(true)})
  return()=>sub.subscription.unsubscribe()
 },[])
 useEffect(()=>{
  if(!supabase||!session){setProfile(null);setOwned([]);return}
  supabase.from('profiles').select('id,display_name,role,verified_artist').eq('id',session.user.id).single().then(({data})=>setProfile((data as Profile)||null))
  supabase.from('orders').select(`id,paid_at,product:products(${PRODUCT_SELECT})`).eq('buyer_id',session.user.id).eq('status','paid').order('paid_at',{ascending:false}).then(({data})=>setOwned((data||[]).map((o:any)=>o.product).filter(Boolean).map(mapProduct)))
 },[session?.user.id,libVersion])
 useEffect(()=>{
  setCampaign(null)
  if(!supabase||page!=='detail'||!selected.id)return
  let off=false
  supabase.from('campaigns').select('id').eq('product_id',selected.id).order('created_at',{ascending:false}).limit(1).then(async({data})=>{
   if(off||!data?.length)return
   const {data:prog}=await supabase!.rpc('campaign_progress',{p_campaign:data[0].id})
   if(!off&&prog)setCampaign(prog as CampaignProgress)
  })
  return()=>{off=true}
 },[selected.id,page])
 const payNow=async()=>{
  if(paying)return
  if(!supabase||!API){setToast('Payments are not connected yet.');return}
  if(!session){setAfterAuth('checkout');setAuthNote('Sign in or create an account to buy. Your library then follows you to any device.');go('signin');return}
  const pwyw=selected.pricingMode==='pay_what_you_want'
  const amt=Math.round(Number(payAmount))
  if(pwyw&&(!Number.isFinite(amt)||amt<(selected.minPrice||1000))){setToast(`The minimum for this release is ${money(selected.minPrice||1000)}.`);return}
  if((pwyw?amt:selected.price)*quantity>1000000){setToast('One order is limited to ₦1,000,000. Choose fewer units.');return}
  setPaying(true);setToast('Taking you to Paystack...')
  const r=await apiCall<{authorizationUrl?:string;error?:string}>('/api/initialize-payment',{auth:true,body:{productId:selected.id,amount:pwyw?amt:undefined,quantity}})
  if(!r.ok||!r.data.authorizationUrl){setToast(r.data.error||'Could not start payment.');setPaying(false);return}
  window.location.href=r.data.authorizationUrl
 }
 useEffect(()=>{
  const ref=new URLSearchParams(window.location.search).get('reference')
  if(!ref||!/^atu_[a-f0-9-]{36}$/i.test(ref))return
  setToast('Confirming your payment...')
  apiCall<{verified?:boolean;error?:string}>('/api/verify-payment',{body:{reference:ref}}).then(r=>{
   window.history.replaceState({},'',window.location.pathname)
   if(r.ok&&r.data.verified){setToast('Payment confirmed. It is in your library.');setLibVersion(v=>v+1);setPage('library')}
   else setToast(r.data.error||'We could not confirm that payment.')
  })
 },[])
 useEffect(()=>{if(!toast)return;const t=setTimeout(()=>setToast(''),3200);return()=>clearTimeout(t)},[toast]);
 const featured=useMemo(()=>[...releases].filter(r=>r.published!==false).slice(0,4),[releases]);
 const filtered=useMemo(()=>releases.filter(r=>r.published!==false && (catGroup==='all'||groupOf(r.category)===catGroup) && (catSlug==='all'||r.category===catSlug) && (category==='All'||(category==='Albums & EPs'&&/Album|EP/.test(r.type))||(category==='Singles'&&r.type.includes('Single'))||(category==='Live & Video'&&/Live|Video/.test(r.type))||(category==='Exclusive'&&(r.tag==='Exclusive'||!!r.benefits?.length))) && `${r.title} ${r.artist} ${r.type}`.toLowerCase().includes(search.toLowerCase())),[releases,category,search,catGroup,catSlug]);
 const go=(p:Page)=>{if(p!=='artistPage'&&p!=='info'&&window.location.hash)window.history.replaceState(null,'',window.location.pathname+window.location.search);setPage(p);setMenuOpen(false);setShowSearch(false);window.scrollTo({top:0,behavior:'smooth'})};
 const openRelease=(r:Release)=>{setSelected(r);go('detail')};
 const startCheckout=(r:Release)=>{setSelected(r);setPendingOrder(false);setPayAmount(String(r.price));setQuantity(1);go('checkout')};
 const next=()=>setSlide(v=>(v+1)%Math.max(1,featured.length)); const prev=()=>setSlide(v=>(v-1+Math.max(1,featured.length))%Math.max(1,featured.length));
 const categories=['All','Albums & EPs','Singles','Live & Video','Exclusive'];
 return <ArtistNav.Provider value={openArtist}><div className="app-shell">
  {(!supabase||!API)&&<div className="demo-strip"><span className="demo-dot"/> SETUP INCOMPLETE <span className="strip-separator">/</span> Accounts or payments are not connected yet.</div>}
  <header className="topbar"><button className="wordmark" onClick={()=>go('explore')} aria-label="A Thousand Units home"><img className="brand-logo" src={asset('/images/1000-units-logo.webp')} alt="A Thousand Units" /></button>
   <nav className={`nav-links ${menuOpen?'open':''}`} aria-label="Main navigation"><button className={page==='explore'?'active':''} onClick={()=>go('explore')}>Explore</button><button onClick={()=>{setShowSearch(v=>!v);go('explore');setTimeout(()=>document.getElementById('market-search')?.focus(),50)}}>Search</button><button className={page==='library'?'active':''} onClick={()=>go('library')}>My Library</button><button className={page==='artist'?'active':''} onClick={()=>go('artist')}>For Artists</button></nav>
   <div className="top-actions"><button className="icon-btn search-toggle" aria-label="Search releases" onClick={()=>{setShowSearch(v=>!v);go('explore');setTimeout(()=>document.getElementById('market-search')?.focus(),50)}}><Search size={18}/></button>{session?<div className="acct"><button className="sign-in" aria-haspopup="menu" aria-expanded={acctOpen} onClick={()=>setAcctOpen(v=>!v)}>{profile?.display_name||'Account'} <ChevronDown size={14}/></button>{acctOpen&&<div className="acct-menu" role="menu"><button role="menuitem" onClick={()=>{setAcctOpen(false);go('library')}}>My Library</button><button role="menuitem" onClick={()=>{setAcctOpen(false);go('artist')}}>{profile?.role==='artist'?'Creator studio':'For artists'}</button><button role="menuitem" className="danger" onClick={signOut}>Sign out</button></div>}</div>:<button className="sign-in" onClick={()=>{setAuthNote('');go('signin')}}><LogIn size={16}/> Sign in</button>}<button className="mobile-menu icon-btn" onClick={()=>setMenuOpen(v=>!v)} aria-label="Toggle menu">{menuOpen?<X/>:<Menu/>}</button></div>
  </header>
  {page==='explore'&&<main>
   <section className="hero"><div className="hero-copy"><div className="eyebrow"><span className="eyebrow-line"/> MUSIC, DIRECT FROM THE SOURCE</div><h1>Own a piece<br/>of the <em>sound.</em></h1><p>Discover the music, stories and special releases artists make for the people who make it matter.</p><div className="hero-actions"><button className="btn btn-accent" onClick={()=>document.getElementById('discover')?.scrollIntoView({behavior:'smooth'})}>Explore releases <ArrowDownRight size={18}/></button><button className="text-link" onClick={()=>go('artist')}>I’m an artist <ArrowUpRight size={16}/></button></div><div className="hero-foot"><div className="avatar-stack"><img src={art.artist1}/><img src={art.artist2}/><img src={art.artist4}/></div><span>Independent voices.<br/><b>Worth collecting.</b></span></div></div>
    <div className="hero-art"><div className="hero-image-main"><img src={featured[slide]?.image||art.cover1} alt={`${featured[slide]?.title||'Featured release'} artwork`}/><div className="image-shade"/><div className="art-topline"><span>RELEASE Nº 00{slide+1}</span><span>ATU SELECTS ↗</span></div><div className="hero-art-caption"><div><span className="tiny-label">FEATURED RELEASE</span><h2>{featured[slide]?.title||'New releases are on the way'}</h2><p>{featured[slide]?.artist||'Independent artists'} <span>·</span> {featured[slide]?.type||'Direct from the source'}</p></div><button className="round-arrow" onClick={()=>featured[slide]&&openRelease(featured[slide])} aria-label="Open featured release"><ArrowUpRight/></button></div></div><div className="hero-controls"><span>{String(slide+1).padStart(2,'0')} <i>/</i> {String(featured.length).padStart(2,'0')}</span><div className="control-track"><span style={{width:`${((slide+1)/Math.max(featured.length,1))*100}%`}}/></div><div className="control-buttons"><button onClick={prev} aria-label="Previous featured release"><ChevronLeft size={18}/></button><button onClick={next} aria-label="Next featured release"><ChevronRight size={18}/></button></div></div></div>
   </section>
   <section className="search-row" id="discover"><div><span className="section-kicker">THE COLLECTION</span><h2>Find your next <em>favourite.</em></h2></div><div className={`search-box ${showSearch?'search-visible':''}`}><Search size={18}/><input id="market-search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search artists, releases..."/><button onClick={()=>{setSearch('');setCategory('All')}} aria-label="Clear search"><X size={16}/></button></div></section>
   <div className="cat-filter"><div className="filters" role="tablist" aria-label="Categories">{(['all','music','fashion','others'] as const).map(g=>{const open=g==='all'||cats.some(c=>c.group_name===g&&c.enabled);return <button key={g} role="tab" aria-selected={catGroup===g} className={catGroup===g?'selected':''} onClick={()=>{setCatGroup(g);setCatSlug('all')}}>{g==='all'?'Everything':g[0].toUpperCase()+g.slice(1)}{!open&&<em className="soon">Soon</em>}</button>})}</div>{catGroup!=='all'&&<div className="filters sub">{[{slug:'all',label:`All ${catGroup}`,enabled:true},...cats.filter(c=>c.group_name===catGroup)].map(c=><button key={c.slug} disabled={!c.enabled} className={catSlug===c.slug?'selected':''} onClick={()=>setCatSlug(c.slug)}>{c.label}{!c.enabled&&<em className="soon">Soon</em>}</button>)}</div>}</div>
   <div className="filter-row"><div className="filters">{categories.map(c=><button key={c} className={category===c?'selected':''} onClick={()=>setCategory(c)}>{c}</button>)}</div><span className="results-count"><SlidersHorizontal size={14}/> {filtered.length} releases</span></div>
   {catGroup==='all'&&catSlug==='all'&&<><ReleaseSection title="Discovered on A Thousand Units" subtitle="Good things travel by word of mouth." releases={filtered.slice(0,4)} onOpen={openRelease} onBuy={startCheckout} onSeeAll={()=>{setCategory('All');document.getElementById('all-releases')?.scrollIntoView({behavior:'smooth'})}}/>
   <section className="dark-feature"><div className="dark-feature-copy"><span className="section-kicker light">MADE FOR THE MOMENT</span><h2>More than a stream.<br/><em>Something to keep.</em></h2><p>Buy a release, get closer to the process. From bonus tracks to studio diaries, every drop can hold a little more.</p><button className="btn btn-accent" onClick={()=>{setCategory('Exclusive');document.getElementById('exclusive')?.scrollIntoView({behavior:'smooth'})}}>Explore exclusive access <ArrowRight size={17}/></button></div><div className="dark-feature-visual"><img src={art.cover5} alt="Artist studio session"/><div className="exclusive-stamp"><Sparkles size={18}/><span>THE<br/>EXTRA<br/>TAKE</span></div><div className="visual-note">THE MUSIC IS JUST THE BEGINNING.</div></div></section>
   <ReleaseSection id="trending" title="Moving right now" subtitle="Independent releases finding their people." releases={[...filtered].sort((a,b)=>Number((b.plays||'0').replace(/[^0-9.]/g,''))-Number((a.plays||'0').replace(/[^0-9.]/g,''))).slice(0,4)} onOpen={openRelease} onBuy={startCheckout} icon={<TrendingUp size={17}/>}/>
   <ReleaseSection id="exclusive" title="A little extra, just for you" subtitle="Bonus material, behind-the-scenes and more to take home." releases={filtered.filter(r=>r.tag==='Exclusive'||r.benefits?.length).slice(0,4)} onOpen={openRelease} onBuy={startCheckout} onSeeAll={()=>{setCategory('Exclusive');document.getElementById('discover')?.scrollIntoView({behavior:'smooth'})}}/>
   <ReleaseSection title="Fresh off the press" subtitle="The newest things from independent artists." releases={[...filtered].sort((a,b)=>String(b.date ?? '').localeCompare(String(a.date ?? ''))).slice(0,4)} onOpen={openRelease} onBuy={startCheckout} icon={<Sparkles size={17}/>}/>
   {makers.length>0&&<section className="artists-section"><div className="section-head"><div><span className="section-kicker">MEET THE MAKERS</span><h2>Know the name.<br/><em>Feel the work.</em></h2></div><button className="text-link" onClick={()=>go('artist')}>Artists, start here <ArrowUpRight size={16}/></button></div><div className="artist-grid">{makers.map((a,i)=><article className="artist-card" key={a.id}><button className="artist-photo" onClick={()=>openArtist(a.id)} aria-label={`See releases by ${a.displayName}`}><img src={a.avatarUrl||a.coverImage||art.cover5} alt=""/><span>{String(i+1).padStart(2,'0')}</span><ArrowUpRight size={19}/></button><div className="artist-meta"><div><h3><button className="release-title" onClick={()=>openArtist(a.id)}>{a.displayName}</button></h3><p>{a.categories.join(' · ')}{a.categories.length?' · ':''}{a.followers.toLocaleString('en-NG')} {a.followers===1?'follower':'followers'}</p></div><button className={`follow-btn ${follows.includes(a.id)?'on':''}`} onClick={()=>toggleFollow(a.id)}>{follows.includes(a.id)?'Following':'Follow'}</button></div>{a.bio&&<p className="artist-bio" style={{textAlign:'left',maxWidth:'none',marginTop:6}}>{a.bio}</p>}</article>)}</div></section>}
   <section className="artist-cta"><div className="cta-orbit">1000<span>u</span></div><div><span className="section-kicker">YOUR WORK. YOUR PEOPLE.</span><h2>Make something.<br/><em>Put it out there.</em></h2><p>Set your price. Tell your story. Let your audience support the work directly.</p></div><button className="btn btn-dark" onClick={()=>go('artist')}>Start as an artist <ArrowUpRight size={17}/></button></section></>}
   {catGroup!=='all'&&!cats.some(c=>c.group_name===catGroup&&c.enabled)&&<div className="coming-soon"><div><b>{catGroup[0].toUpperCase()+catGroup.slice(1)} is coming soon.</b><br/>We are opening new categories once music is running smoothly.</div></div>}
   <section id="all-releases" className="all-releases"><div className="section-head"><div><span className="section-kicker">KEEP EXPLORING</span><h2>All releases <span className="count-pill">{filtered.length}</span></h2></div></div>{filtered.length?<div className="release-grid">{filtered.map(r=><ReleaseCard key={r.id} release={r} onOpen={openRelease} onBuy={startCheckout}/>)}</div>:<Empty title="Nothing found just yet" text="Try a different search or category." action={()=>{setSearch('');setCategory('All');setCatGroup('all');setCatSlug('all')}} actionLabel="Reset filters"/>}</section>
  </main>}
  {page==='detail'&&<main className="page-main"><button className="back-link" onClick={()=>go('explore')}><ArrowLeft size={16}/> Back to Explore</button><section className="detail-layout"><div className="detail-cover"><img src={selected.image} alt={`${selected.title} cover artwork`}/><span className="cover-label">A THOUSAND UNITS · RELEASE</span></div><div className="detail-info"><span className="section-kicker">{selected.type.toUpperCase()}</span><h1>{selected.title}</h1><button className="detail-artist" onClick={()=>{if(selected.artistId)openArtist(selected.artistId);else{setSearch(selected.artist);go('explore')}}}>{selected.artist} <ArrowUpRight size={16}/></button><div className="detail-actions-row">{selected.artistId&&selected.artistId!==session?.user.id&&<button className={`follow-btn ${follows.includes(selected.artistId)?'on':''}`} onClick={()=>toggleFollow(selected.artistId)}>{follows.includes(selected.artistId)?'Following':'Follow'}</button>}{selected.artistId&&<span>{artistFollowers.toLocaleString('en-NG')} {artistFollowers===1?'follower':'followers'}</span>}</div><p className="detail-description">{selected.description}</p>{campaign&&<CampaignCard c={campaign}/>}{owned.some(o=>o.id===selected.id)&&<OwnedFiles key={selected.id} productId={selected.id} setToast={setToast}/>}{selected.id&&!owned.some(o=>o.id===selected.id)&&<PreviewPlayer key={selected.id} productId={selected.id}/>}<div className="detail-price-row"><div><span className="tiny-label">{selected.pricingMode==='pay_what_you_want'?'PAY WHAT YOU WANT':'OWN THIS RELEASE'}</span><strong>{priceLabel(selected)}</strong>{selected.pricingMode==='pay_what_you_want'&&<span className="pwyw-note">SUGGESTED {money(selected.price)}</span>}</div>{owned.some(o=>o.id===selected.id)?<span className="status-pill"><span/>In your library</span>:<button className="btn btn-accent" onClick={()=>startCheckout(selected)}>Buy release <ArrowUpRight size={18}/></button>}</div><p className="secure-note"><LockKeyhole size={14}/> Secure checkout · One-time purchase · Price in NGN</p><div className="detail-divider"/><h3>What’s included</h3><ul className="benefit-list">{(selected.benefits?.length?selected.benefits:['Digital release','Access from your personal library']).map(b=><li key={b}><BadgeCheck size={17}/>{b}</li>)}</ul><div className="detail-divider"/><div className="track-head"><h3>Tracklist <span>{selected.tracks.length} tracks</span></h3><span className="tiny-label">DIGITAL RELEASE</span></div><ol className="track-list">{selected.tracks.map((t,i)=><li key={`${t}-${i}`}><span className="track-number">{String(i+1).padStart(2,'0')}</span><span>{t}</span><span className="track-length">—</span></li>)}</ol><div className="artist-note"><div className="artist-note-icon"><Music2/></div><div><span className="tiny-label">FROM THE ARTIST</span><p>“Thank you for supporting the work directly. Every purchase helps make the next one possible.”</p><b>{selected.artist}</b></div></div><p className="detail-actions-row"><button className="report-link" onClick={()=>setReporting(true)}>Report a copyright or content problem</button></p></div></section><section className="detail-more"><div className="section-head"><div><span className="section-kicker">KEEP LISTENING</span><h2>More from the collection</h2></div></div><div className="release-grid">{releases.filter(r=>r.id!==selected.id).slice(0,4).map(r=><ReleaseCard key={r.id} release={r} onOpen={openRelease} onBuy={startCheckout}/>)}</div></section></main>}
  {page==='checkout'&&<main className="page-main checkout-page"><button className="back-link" onClick={()=>go('detail')}><ArrowLeft size={16}/> Back to release</button><div className="checkout-wrap"><div className="checkout-heading"><span className="section-kicker">CHECKOUT</span><h1>Make it <em>yours.</em></h1><p>One small step between you and the music.</p></div><div className="checkout-card"><div className="order-summary"><img src={selected.image} alt=""/><div><span className="tiny-label">YOUR ORDER</span><h3>{selected.title}</h3><p>{selected.artist} · {selected.type}</p></div></div>
  {selected.pricingMode==='pay_what_you_want'?<><label className="field-label" htmlFor="pay-amount">Choose your price (₦)</label><input id="pay-amount" className="field" type="number" min={selected.minPrice||1000} step="1" inputMode="numeric" value={payAmount} onChange={e=>setPayAmount(e.target.value)}/><span className="field-help">Minimum {money(selected.minPrice||1000)}. Suggested {money(selected.price)}. Most of what you pay goes to the artist.</span></>:<div className="checkout-line"><span>Price per unit</span><b>{money(selected.price)}</b></div>}
  <div className="qty-row"><span className="field-label" style={{margin:0}}>Units</span><div className="qty"><button aria-label="Fewer units" disabled={quantity<=1} onClick={()=>setQuantity(q=>Math.max(1,q-1))}>−</button><span aria-live="polite">{quantity}</span><button aria-label="More units" disabled={quantity>=10} onClick={()=>setQuantity(q=>Math.min(10,q+1))}>+</button></div></div><span className="field-help">You always get one copy. Extra units are extra support for the artist and count toward their campaign goal. Up to 10 per order.</span>
  <div className="checkout-total"><span>Total{quantity>1?` · ${quantity} units`:''}</span><strong>{money((selected.pricingMode==='pay_what_you_want'?(Number(payAmount)||0):selected.price)*quantity)}</strong></div>
  {session?<p className="field-help">Your receipt and access are linked to {session.user.email}.</p>:<div className="inline-alert"><LockKeyhole size={18}/><div><b>Sign in to buy</b><p>Your purchase is saved to your account so it follows you to any device.</p></div></div>}
  <div className="payment-placeholder"><Wallet size={19}/><div><b>Secure payment with Paystack</b><span>You will be taken to Paystack to pay.</span></div><LockKeyhole size={16}/></div>
  {chargedBy&&<p className="charged-by">A Thousand Units Charged By <b>{chargedBy}</b></p>}
  <button className="btn btn-dark full-btn" disabled={paying} onClick={payNow}>{session?(paying?'Please wait...':'Continue to payment'):'Sign in to continue'} <ArrowRight size={18}/></button>
  <p className="checkout-terms"><LockKeyhole size={13}/><span>By paying you agree to our <a href="#/terms" target="_blank" rel="noopener">Terms</a> and <a href="#/refunds" target="_blank" rel="noopener">refund policy</a>. Your payment is confirmed by our server before anything is unlocked.</span></p></div><div className="checkout-assurance"><div><ShieldCheck/><span>Every payment<br/>verified</span></div><div><Library/><span>Your releases<br/>in one library</span></div><div><Headphones/><span>Support the artist<br/>directly</span></div></div></div></main>}
  {page==='library'&&<main className="page-main"><div className="page-title-row"><div><span className="section-kicker">YOUR COLLECTION</span><h1>My <em>Library.</em></h1><p>Your purchased releases, all in one place.</p></div>{session&&<div className="library-user"><div className="user-circle">{(profile?.display_name||session.user.email||'F')[0].toUpperCase()}</div><span>{profile?.display_name||'Account'}<br/><button className="text-link" onClick={signOut}>Sign out</button></span></div>}</div>
  {!session?<Empty title="Sign in to see your library" text="Your purchases are saved to your account." action={()=>{setAfterAuth('library');setAuthNote('');go('signin')}} actionLabel="Sign in"/>:<><div className="section-head library-heading"><div><span className="section-kicker">COLLECTED BY YOU</span><h2>Purchased releases <span className="count-pill">{owned.length}</span></h2></div></div>{owned.length?<div className="release-grid">{owned.map(r=><ReleaseCard key={r.id} release={r} onOpen={openRelease} onBuy={openRelease}/>)}</div>:<Empty title="Your library is waiting" text="When you buy a release and your payment is verified, it will appear here." action={()=>go('explore')} actionLabel="Explore releases"/>}</>}</main>}
  {page==='artist'&&(profile?.role==='artist'?<ArtistStudio profile={profile} setToast={setToast} openRelease={openRelease} onSignOut={signOut} onProfileUpdated={u=>setProfile(p=>p?{...p,...u}:p)}/>:<ApplyPage session={session} profile={profile} onSignIn={()=>{setAfterAuth('artist');setAuthNote('Create an account or sign in to apply to sell on A Thousand Units.');go('signin')}} onExplore={()=>go('explore')} setToast={setToast}/>)}
  {page==='artistPage'&&artistId&&<ArtistPage key={artistId} artistId={artistId} following={follows.includes(artistId)} isSelf={session?.user.id===artistId} onFollow={toggleFollow} onBack={()=>go('explore')} setToast={setToast} renderCard={r=><ReleaseCard key={r.id} release={r} onOpen={openRelease} onBuy={startCheckout}/>}/>}
  {page==='info'&&<InfoPage kind={infoKind} onBack={()=>go('explore')}/>}
  {page==='admin'&&<main className="page-main"><div className="dashboard-top"><div><span className="section-kicker">OPERATIONS · DEMO</span><h1>Marketplace <em>overview.</em></h1><p>A basic operational view for A Thousand Units administrators.</p></div><div className="admin-pill"><ShieldCheck size={16}/> Admin preview</div></div><div className="metric-grid"><Metric icon={<Disc3/>} label="Listed releases" value={String(releases.filter(r=>r.published!==false).length)} note="Sample and browser demo data"/><Metric icon={<ShoppingBag/>} label="Verified orders" value="0" note="Payment verification not connected"/><Metric icon={<Wallet/>} label="Gross merchandise value" value="₦0" note="No real transactions recorded"/></div><div className="admin-grid"><div className="dashboard-panel"><div className="panel-head"><div><h2>Content review</h2><p>Newly published demo releases.</p></div></div>{releases.slice(0,5).map(r=><div className="admin-row" key={r.id}><img src={r.image} alt=""/><div><b>{r.title}</b><span>{r.artist}</span></div><span className="status-pill"><span/>Demo listing</span><button className="text-link" onClick={()=>openRelease(r)}>Review</button></div>)}</div><div className="dashboard-panel"><div className="panel-head"><div><h2>Operational checks</h2><p>Production readiness indicators.</p></div></div>{[['Supabase authentication','Not connected'],['Payment verification','Not connected'],['Protected media delivery','Not connected'],['Refund and dispute workflow','Not connected'],['Audit logging','Not connected']].map(([a,b])=><div className="check-row" key={a}><span>{a}</span><span className="warning-status"><i/>{b}</span></div>)}</div></div></main>}
  {page==='signin'&&<AuthPage note={authNote} setToast={setToast} onDone={()=>{setAuthNote('');const t=afterAuth;setAfterAuth('explore');if(t==='artistPage'&&artistId)openArtist(artistId);else go(t);setToast('Signed in.')}}/>}
  {recovery&&session&&<RecoveryDialog onDone={()=>{setRecovery(false);setToast('Password updated.')}} onCancel={()=>setRecovery(false)} setToast={setToast}/>}
  {reporting&&selected.id&&<ReportDialog productId={selected.id} title={selected.title} onClose={()=>setReporting(false)} setToast={setToast}/>}
  <footer className="footer"><div className="footer-top"><button className="wordmark footer-wordmark" onClick={()=>go('explore')}><img className="brand-logo" src={asset('/images/1000-units-logo.webp')} alt="A Thousand Units" /></button><p>Independent music deserves<br/>a direct line to its people.</p><button className="back-top" onClick={()=>window.scrollTo({top:0,behavior:'smooth'})}>BACK TO TOP <ArrowUpRight size={15}/></button></div><div className="footer-bottom"><span>© {new Date().getFullYear()} A THOUSAND UNITS</span><div><a href="#/about">About</a><button onClick={()=>go('artist')}>For artists</button><a href="#/help">Help</a><a href="#/terms">Terms</a><a href="#/privacy">Privacy</a><a href="#/refunds">Refunds</a></div><span className="footer-location">BUILT FOR EVERYWHERE ↗</span></div></footer>
  {toast&&<div className="toast" role="status"><span className="toast-dot"/>{toast}<button onClick={()=>setToast('')} aria-label="Dismiss notification"><X size={15}/></button></div>}
 </div></ArtistNav.Provider>
}
function ReleaseSection({title,subtitle,releases,onOpen,onBuy,onSeeAll,icon,id}:{title:string;subtitle:string;releases:Release[];onOpen:(r:Release)=>void;onBuy:(r:Release)=>void;onSeeAll?:()=>void;icon?:React.ReactNode;id?:string}){return <section className="release-section" id={id}><div className="section-head"><div><span className="section-kicker">{icon||<AudioLines size={15}/>} <span>CURATED FOR YOUR EARS</span></span><h2>{title}</h2><p>{subtitle}</p></div>{onSeeAll&&<button className="text-link see-all" onClick={onSeeAll}>View all <ArrowRight size={16}/></button>}</div>{releases.length?<div className="release-grid">{releases.map(r=><ReleaseCard key={r.id} release={r} onOpen={onOpen} onBuy={onBuy}/>)}</div>:<div className="section-empty">No releases in this collection yet.</div>}</section>}
function ReleaseCard({release:r,onOpen,onBuy}:{release:Release;onOpen:(r:Release)=>void;onBuy:(r:Release)=>void}){const toArtist=useContext(ArtistNav);return <article className="release-card"><button className="release-art" onClick={()=>onOpen(r)} aria-label={`View ${r.title}`}><img src={r.image} alt={`${r.title} cover artwork`} loading="lazy"/>{r.tag&&<span className="release-tag">{r.tag}</span>}<span className="art-open"><ArrowUpRight size={19}/></span></button><div className="release-card-info"><button className="release-title" onClick={()=>onOpen(r)}>{r.title}</button><button className="release-artist" onClick={()=>r.artistId?toArtist(r.artistId):onOpen(r)}>{r.artist}</button><div className="release-card-bottom"><span>{r.type}</span><b>{priceLabel(r)}</b></div><button className="quick-buy" onClick={()=>onBuy(r)}>Get release <ArrowUpRight size={14}/></button></div></article>}
function Empty({title,text,action,actionLabel}:{title:string;text:string;action?:()=>void;actionLabel?:string}){return <div className="empty-state"><div className="empty-icon"><Music2 size={22}/></div><h3>{title}</h3><p>{text}</p>{action&&<button className="btn btn-outline" onClick={action}>{actionLabel||'Continue'} <ArrowRight size={16}/></button>}</div>}
function Metric({icon,label,value,note}:{icon:React.ReactNode;label:string;value:string;note:string}){return <div className="metric-card"><div className="metric-top"><span className="metric-icon">{icon}</span><span className="metric-note">DEMO</span></div><span className="metric-label">{label}</span><strong>{value}</strong><span className="metric-foot">{note}</span></div>}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>)
