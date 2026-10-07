import { supabase } from './supabase'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY

export const pushSupported =
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

// Converts the base64 VAPID key into the format the browser expects
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null
  return navigator.serviceWorker.register('/sw.js')
}

export async function isSubscribed() {
  if (!pushSupported) return false
  const reg = await navigator.serviceWorker.getRegistration()
  if (!reg) return false
  return Boolean(await reg.pushManager.getSubscription())
}

// Asks permission, subscribes this device, and saves it so the daily job can reach it
export async function enableReminders() {
  if (!pushSupported) {
    throw new Error(
      'This browser cannot receive notifications. On iPhone, first tap Share → "Add to Home Screen", then open the app from there.'
    )
  }
  if (!VAPID_PUBLIC_KEY) throw new Error('VITE_VAPID_PUBLIC_KEY is missing in your .env / Vercel settings.')

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Notifications were blocked. Allow them in your browser settings.')

  const reg = (await navigator.serviceWorker.getRegistration()) || (await registerServiceWorker())
  await navigator.serviceWorker.ready

  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    })
  }

  const json = sub.toJSON()
  const { error } = await supabase.from('push_subscriptions').upsert(
    { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth },
    { onConflict: 'endpoint' }
  )
  if (error) throw error
}

export async function disableReminders() {
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (sub) {
    await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
    await sub.unsubscribe()
  }
}
