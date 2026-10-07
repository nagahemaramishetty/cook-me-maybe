// Supabase Edge Function: send-reminders
// Runs once a day (triggered by pg_cron). For every user, finds uncooked items that go bad
// within the next 4 days (including today) and sends ONE push notification listing them.

import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const REMIND_DAYS = 4

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:you@example.com'
const CRON_SECRET = Deno.env.get('CRON_SECRET')!
// Your local time zone, so "today" matches your kitchen calendar
const TIME_ZONE = Deno.env.get('TIME_ZONE') ?? 'America/New_York'

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

function localDate(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400000)
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(d)
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86400000)
}

function describe(n: number): string {
  if (n === 0) return 'today'
  if (n === 1) return 'tomorrow'
  return `in ${n} days`
}

Deno.serve(async (req) => {
  // Only the scheduled job (which knows the secret) may trigger this
  if (req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return new Response('Unauthorized', { status: 401 })
  }

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  const today = localDate(0)
  const until = localDate(REMIND_DAYS)

  const { data: items, error } = await db
    .from('items')
    .select('user_id, name, expiry_date')
    .eq('cooked', false)
    .gte('expiry_date', today)
    .lte('expiry_date', until)
    .order('expiry_date')
  if (error) return new Response(error.message, { status: 500 })

  // Group items by user
  const byUser = new Map<string, { name: string; days: number }[]>()
  for (const it of items ?? []) {
    const list = byUser.get(it.user_id) ?? []
    list.push({ name: it.name, days: daysBetween(today, it.expiry_date) })
    byUser.set(it.user_id, list)
  }

  let sent = 0
  let removed = 0
  for (const [userId, list] of byUser) {
    const { data: subs } = await db
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('user_id', userId)
    if (!subs?.length) continue

    const first = list[0]
    const title =
      list.length === 1
        ? `Cook your ${first.name} ${first.days === 0 ? 'today' : 'soon'}! 🥘`
        : `${list.length} things to cook soon 🥘`
    const body = list.map((i) => `${i.name}: goes bad ${describe(i.days)}`).join('\n')
    const payload = JSON.stringify({ title, body })

    for (const s of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
          { TTL: 60 * 60 * 12 }
        )
        sent++
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode
        // 404/410 = the device unsubscribed or the browser data was cleared; clean it up
        if (code === 404 || code === 410) {
          await db.from('push_subscriptions').delete().eq('id', s.id)
          removed++
        } else {
          console.error('push failed', code, err)
        }
      }
    }
  }

  return Response.json({ today, users: byUser.size, sent, removed })
})
