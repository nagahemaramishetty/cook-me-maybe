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

function todayStr() {
  const d = new Date()
  return toDateStr(d)
}
function toDateStr(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
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
  if (n < 0) return { cls: 'expired', label: `Expired ${-n}d ago` }
  if (n === 0) return { cls: 'urgent', label: 'Cook today!' }
  if (n === 1) return { cls: 'urgent', label: 'Tomorrow' }
  if (n <= REMIND_DAYS) return { cls: 'soon', label: `${n} days left` }
  return { cls: 'fresh', label: `${n} days left` }
}
function prettyDate(s) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

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
  return session ? <Fridge session={session} /> : <Login />
}

function NotConfigured() {
  return (
    <div className="shell">
      <Header />
      <div className="card">
        <h2>Almost there</h2>
        <p>Add your Supabase URL, key and VAPID public key as environment variables (see <b>SETUP.md</b>), then restart or redeploy.</p>
      </div>
    </div>
  )
}

function Header({ onSignOut }) {
  return (
    <header className="top">
      <div className="brand">
        <span className="logo" aria-hidden>🥬</span>
        <div>
          <h1>Cook Me Maybe</h1>
          <p className="tag">Cook it before it goes bad</p>
        </div>
      </div>
      {onSignOut && (
        <button className="ghost" onClick={onSignOut}>Sign out</button>
      )}
    </header>
  )
}

function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState('signin')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setMsg('')
    const fn = mode === 'signin' ? supabase.auth.signInWithPassword : supabase.auth.signUp
    const { data, error } = await fn.call(supabase.auth, { email, password })
    setBusy(false)
    if (error) return setMsg(error.message)
    if (mode === 'signup' && !data.session) setMsg('Check your email to confirm your account, then sign in.')
  }

  return (
    <div className="shell">
      <Header />
      <form className="card" onSubmit={submit}>
        <h2>{mode === 'signin' ? 'Sign in' : 'Create your account'}</h2>
        <label>Email
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </label>
        <label>Password
          <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} />
        </label>
        <button className="primary" disabled={busy}>{busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Sign up'}</button>
        {msg && <p className="note">{msg}</p>}
        <button type="button" className="link" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
          {mode === 'signin' ? "New here? Create an account" : 'Already have an account? Sign in'}
        </button>
      </form>
    </div>
  )
}

function Fridge({ session }) {
  const [items, setItems] = useState([])
  const [name, setName] = useState('')
  const [expiry, setExpiry] = useState(addDays(3))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [showCooked, setShowCooked] = useState(false)

  async function load() {
    const { data, error } = await supabase
      .from('items')
      .select('*')
      .order('expiry_date', { ascending: true })
    if (error) setError(error.message)
    else setItems(data)
  }
  useEffect(() => { load() }, [])

  async function save(e) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    const { error } = await supabase.from('items').insert({ name: name.trim(), expiry_date: expiry })
    setSaving(false)
    if (error) return setError(error.message)
    setName('')
    setExpiry(addDays(3))
    load()
  }

  async function markCooked(item, cooked = true) {
    await supabase.from('items').update({ cooked }).eq('id', item.id)
    load()
  }
  async function remove(item) {
    if (!confirm(`Remove ${item.name}?`)) return
    await supabase.from('items').delete().eq('id', item.id)
    load()
  }

  const active = useMemo(() => items.filter((i) => !i.cooked), [items])
  const cooked = useMemo(() => items.filter((i) => i.cooked), [items])
  const dueSoon = active.filter((i) => daysLeft(i.expiry_date) <= REMIND_DAYS && daysLeft(i.expiry_date) >= 0).length

  return (
    <div className="shell">
      <Header onSignOut={() => supabase.auth.signOut()} />

      <ReminderToggle />

      <form className="card add" onSubmit={save}>
        <h2>Add to fridge</h2>
        <label>Vegetable / item
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
        <p className="muted small">You'll get a reminder every morning starting {REMIND_DAYS} days before this date.</p>
      </form>

      {error && <p className="note">{error}</p>}

      <section>
        <div className="section-head">
          <h2>In your fridge</h2>
          {dueSoon > 0 && <span className="pill soon">{dueSoon} to cook soon</span>}
        </div>
        {active.length === 0 ? (
          <p className="muted empty">Nothing yet. Add what you bought today 🛒</p>
        ) : (
          <ul className="list">
            {active.map((item) => {
              const n = daysLeft(item.expiry_date)
              const s = statusOf(n)
              return (
                <li key={item.id} className={`row ${s.cls}`}>
                  <div className="info">
                    <span className="name">{item.name}</span>
                    <span className="date">{prettyDate(item.expiry_date)}</span>
                  </div>
                  <span className={`pill ${s.cls}`}>{s.label}</span>
                  <div className="actions">
                    <button className="cooked" onClick={() => markCooked(item)} title="Mark as cooked">Cooked ✓</button>
                    <button className="x" onClick={() => remove(item)} aria-label={`Remove ${item.name}`}>✕</button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {cooked.length > 0 && (
        <section>
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
        </section>
      )}

      <p className="muted small center foot">Signed in as {session.user.email}</p>
    </div>
  )
}

function ReminderToggle() {
  const [on, setOn] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => { isSubscribed().then(setOn) }, [])

  async function toggle() {
    setBusy(true)
    setMsg('')
    try {
      if (on) { await disableReminders(); setOn(false) }
      else { await enableReminders(); setOn(true); setMsg('Reminders are on for this device 🎉') }
    } catch (e) {
      setMsg(e.message)
    }
    setBusy(false)
  }

  return (
    <div className={`card reminder ${on ? 'on' : ''}`}>
      <div>
        <strong>{on ? '🔔 Reminders on' : '🔕 Reminders off'}</strong>
        <p className="muted small">
          {pushSupported
            ? 'Daily morning nudges on this device.'
            : 'On iPhone: tap Share → Add to Home Screen, then open the app from your home screen.'}
        </p>
      </div>
      <button className={on ? 'ghost' : 'primary'} onClick={toggle} disabled={busy}>
        {busy ? '…' : on ? 'Turn off' : 'Turn on'}
      </button>
      {msg && <p className="note full">{msg}</p>}
    </div>
  )
}
