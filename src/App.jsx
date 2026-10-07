import { useEffect, useMemo, useState } from 'react'
import { supabase, configured } from './supabase'
import { enableReminders, disableReminders, isSubscribed, pushSupported } from './push'

// Typical fridge life in days — only used to pre-fill the date. You can always change it.
const QUICK_PICKS = [
  ["Lady's finger", 3],
  ['Spinach', 3],
  ['Coriander', 5],
  ['Tomato', 7],
  ['Capsicum', 7],
  ['Beans', 5],
  ['Brinjal', 5],
  ['Cauliflower', 6],
  ['Cabbage', 14],
  ['Carrot', 21],
  ['Cucumber', 6],
  ['Mushrooms', 4],
]

const REMIND_DAYS = 4

function toDateStr(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
const todayStr = () => toDateStr(new Date())
function addDays(n) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return toDateStr(d)
}
function daysLeft(expiry) {
  const [y, m, d] = expiry.split('-').map(Number)
  const exp = new Date(y, m - 1, d)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((exp - today) / 86400000)
}
function statusOf(n) {
  if (n === 0) return { cls: 'urgent', label: 'Cook today!' }
  if (n === 1) return { cls: 'urgent', label: 'Tomorrow' }
  if (n <= REMIND_DAYS) return { cls: 'soon', label: `${n} days left` }
  return { cls: 'fresh', label: `${n} days left` }
}
function prettyDate(s) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}
const nameOf = (user) => (user?.user_metadata?.full_name || '').trim()

export default function App() {
  const [session, setSession] = useState(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!configured) return setReady(true)
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (!configured) return <NotConfigured />
  if (!ready) return <div className="shell"><p className="muted center">Loading…</p></div>
  return session ? <Home session={session} /> : <Login />
}

function NotConfigured() {
  return (
    <div className="shell">
      <Brand />
      <div className="card">
        <h2>Almost there</h2>
        <p>Add your Supabase URL, key and VAPID public key as environment variables (see <b>SETUP.md</b>), then restart or redeploy.</p>
      </div>
    </div>
  )
}

function Brand({ greeting, onMenu }) {
  return (
    <header className="top">
      <div className="brand">
        <span className="logo" aria-hidden>🥬</span>
        <div>
          <h1>Cook Me Maybe</h1>
          <p className="tag">{greeting || 'Cook it before it goes bad'}</p>
        </div>
      </div>
      {onMenu && (
        <button className="menu-btn" onClick={onMenu} aria-label="Open menu">
          <span /><span /><span />
        </button>
      )}
    </header>
  )
}

function Login() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState('signin')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const signup = mode === 'signup'

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setMsg('')
    const { data, error } = signup
      ? await supabase.auth.signUp({ email, password, options: { data: { full_name: name.trim() } } })
      : await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (error) return setMsg(error.message)
    if (signup && !data.session) setMsg('Check your email to confirm your account, then sign in.')
  }

  return (
    <div className="shell">
      <Brand />
      <form className="card" onSubmit={submit}>
        <h2>{signup ? 'Create your account' : 'Sign in'}</h2>
        {signup && (
          <label>Name
            <input required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="What should we call you?" />
          </label>
        )}
        <label>Email
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </label>
        <label>Password
          <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete={signup ? 'new-password' : 'current-password'} />
        </label>
        <button className="primary" disabled={busy}>{busy ? 'Please wait…' : signup ? 'Sign up' : 'Sign in'}</button>
        {msg && <p className="note">{msg}</p>}
        <button type="button" className="link" onClick={() => { setMode(signup ? 'signin' : 'signup'); setMsg('') }}>
          {signup ? 'Already have an account? Sign in' : 'New here? Create an account'}
        </button>
      </form>
    </div>
  )
}

function Home({ session }) {
  const [view, setView] = useState('add') // 'add' | 'fridge'
  const [menuOpen, setMenuOpen] = useState(false)
  const [items, setItems] = useState([])
  const [error, setError] = useState('')
  const [remindersOn, setRemindersOn] = useState(false)
  const [user, setUser] = useState(session.user)

  async function load() {
    const { data, error } = await supabase.from('items').select('*').order('expiry_date', { ascending: true })
    if (error) setError(error.message)
    else setItems(data)
  }
  useEffect(() => { load() }, [])
  useEffect(() => { isSubscribed().then(setRemindersOn) }, [])

  const name = nameOf(user)
  const fresh = useMemo(() => items.filter((i) => !i.cooked && daysLeft(i.expiry_date) >= 0), [items])
  const wasted = useMemo(() => items.filter((i) => !i.cooked && daysLeft(i.expiry_date) < 0), [items])
  const cooked = useMemo(() => items.filter((i) => i.cooked), [items])

  return (
    <div className="shell">
      <Brand greeting={name ? `Hello, ${name} 👋` : 'Hello 👋'} onMenu={() => setMenuOpen(true)} />

      <nav className="tabs" role="tablist">
        <button role="tab" aria-selected={view === 'add'} className={view === 'add' ? 'tab active' : 'tab'} onClick={() => setView('add')}>
          Add to fridge
        </button>
        <button role="tab" aria-selected={view === 'fridge'} className={view === 'fridge' ? 'tab active' : 'tab'} onClick={() => setView('fridge')}>
          In your fridge{fresh.length > 0 && <span className="count">{fresh.length}</span>}
        </button>
      </nav>

      {!remindersOn && (
        <button className="banner" onClick={() => setMenuOpen(true)}>
          🔕 Reminders are off for this device. <u>Turn them on</u>
        </button>
      )}

      {error && <p className="note">{error}</p>}

      {view === 'add'
        ? <AddPage onSaved={load} onError={setError} />
        : <FridgePage fresh={fresh} cooked={cooked} reload={load} />}

      {menuOpen && (
        <Menu
          user={user}
          name={name}
          wasted={wasted}
          reload={load}
          remindersOn={remindersOn}
          setRemindersOn={setRemindersOn}
          onUserUpdated={setUser}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </div>
  )
}

function AddPage({ onSaved, onError }) {
  const [name, setName] = useState('')
  const [expiry, setExpiry] = useState(addDays(3))
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')

  async function save(e) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    const { error } = await supabase.from('items').insert({ name: name.trim(), expiry_date: expiry })
    setSaving(false)
    if (error) return onError(error.message)
    setSavedMsg(`${name.trim()} added to your fridge ✓`)
    setName('')
    setExpiry(addDays(3))
    onSaved()
    setTimeout(() => setSavedMsg(''), 2500)
  }

  return (
    <form className="card add" onSubmit={save}>
      <h2>Add to fridge</h2>
      <label>Item
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lady's finger" required />
      </label>
      <div className="chips" role="list">
        {QUICK_PICKS.map(([n, d]) => (
          <button type="button" key={n} className="chip" onClick={() => { setName(n); setExpiry(addDays(d)) }}>
            {n}
          </button>
        ))}
      </div>
      <label>Goes bad on
        <input type="date" value={expiry} min={todayStr()} onChange={(e) => setExpiry(e.target.value)} required />
      </label>
      <button className="primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      {savedMsg
        ? <p className="saved">{savedMsg}</p>
        : <p className="muted small">You'll get a reminder every morning starting {REMIND_DAYS} days before this date.</p>}
    </form>
  )
}

function FridgePage({ fresh, cooked, reload }) {
  const [showCooked, setShowCooked] = useState(false)
  const dueSoon = fresh.filter((i) => daysLeft(i.expiry_date) <= REMIND_DAYS).length

  async function markCooked(item, value = true) {
    await supabase.from('items').update({ cooked: value }).eq('id', item.id)
    reload()
  }
  async function remove(item) {
    if (!confirm(`Remove ${item.name}?`)) return
    await supabase.from('items').delete().eq('id', item.id)
    reload()
  }

  return (
    <section>
      <div className="section-head">
        <h2>In your fridge</h2>
        {dueSoon > 0 && <span className="pill soon">{dueSoon} to cook soon</span>}
      </div>
      {fresh.length === 0 ? (
        <p className="muted empty">Nothing yet. Add what you bought today 🛒</p>
      ) : (
        <ul className="list">
          {fresh.map((item) => {
            const s = statusOf(daysLeft(item.expiry_date))
            return (
              <li key={item.id} className={`row ${s.cls}`}>
                <div className="info">
                  <span className="name">{item.name}</span>
                  <span className="date">{prettyDate(item.expiry_date)}</span>
                </div>
                <span className={`pill ${s.cls}`}>{s.label}</span>
                <div className="actions">
                  <button className="cooked" onClick={() => markCooked(item)}>Cooked ✓</button>
                  <button className="x" onClick={() => remove(item)} aria-label={`Remove ${item.name}`}>✕</button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {cooked.length > 0 && (
        <>
          <button className="link" onClick={() => setShowCooked(!showCooked)}>
            {showCooked ? 'Hide' : 'Show'} cooked ({cooked.length})
          </button>
          {showCooked && (
            <ul className="list faded">
              {cooked.map((item) => (
                <li key={item.id} className="row">
                  <div className="info">
                    <span className="name">{item.name}</span>
                    <span className="date">{prettyDate(item.expiry_date)}</span>
                  </div>
                  <div className="actions">
                    <button className="ghost" onClick={() => markCooked(item, false)}>Undo</button>
                    <button className="x" onClick={() => remove(item)} aria-label={`Remove ${item.name}`}>✕</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}

function Menu({ user, name, wasted, reload, remindersOn, setRemindersOn, onUserUpdated, onClose }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [editing, setEditing] = useState(!name)
  const [draftName, setDraftName] = useState(name)

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function toggleReminders() {
    setBusy(true)
    setMsg('')
    try {
      if (remindersOn) { await disableReminders(); setRemindersOn(false) }
      else { await enableReminders(); setRemindersOn(true); setMsg('Reminders are on for this device 🎉') }
    } catch (e) {
      setMsg(e.message)
    }
    setBusy(false)
  }

  async function saveName(e) {
    e.preventDefault()
    const { data, error } = await supabase.auth.updateUser({ data: { full_name: draftName.trim() } })
    if (error) return setMsg(error.message)
    onUserUpdated(data.user)
    setEditing(false)
  }

  async function removeWasted(item) {
    await supabase.from('items').delete().eq('id', item.id)
    reload()
  }

  const initial = (name || user.email || '?').charAt(0).toUpperCase()

  return (
    <div className="overlay" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-label="Menu" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose} aria-label="Close menu">✕</button>

        <div className="profile">
          <span className="avatar" aria-hidden>{initial}</span>
          {editing ? (
            <form className="name-form" onSubmit={saveName}>
              <input value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder="Your name" required autoFocus />
              <button className="primary small-btn">Save</button>
            </form>
          ) : (
            <div>
              <h2 className="profile-name">{name}</h2>
              <p className="muted small">{user.email}</p>
              <button className="link" onClick={() => setEditing(true)}>Edit name</button>
            </div>
          )}
        </div>

        <section className="card wasted">
          <div className="section-head">
            <h2>Food wasted</h2>
            <span className={`pill ${wasted.length ? 'expired' : 'fresh'}`}>{wasted.length}</span>
          </div>
          {wasted.length === 0 ? (
            <p className="muted small">Nothing wasted so far. Keep it up! 🌱</p>
          ) : (
            <ul className="mini-list">
              {wasted.map((item) => (
                <li key={item.id}>
                  <span>{item.name}</span>
                  <span className="muted small">went bad {prettyDate(item.expiry_date)}</span>
                  <button className="x" onClick={() => removeWasted(item)} aria-label={`Remove ${item.name}`}>✕</button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <button className={remindersOn ? 'ghost wide' : 'primary wide'} onClick={toggleReminders} disabled={busy}>
          {busy ? '…' : remindersOn ? '🔕 Turn off notifications' : '🔔 Turn on notifications'}
        </button>
        {!pushSupported && (
          <p className="muted small">On iPhone: tap Share → Add to Home Screen, then open the app from your home screen.</p>
        )}
        {msg && <p className="note">{msg}</p>}

        <button className="ghost wide" onClick={() => supabase.auth.signOut()}>Sign out</button>

        <p className="credit">designed and developed by ‘Naga Hema Ramishetty’</p>
      </aside>
    </div>
  )
}
