import { api, type TripRef } from './api'

export type PushResult = 'ok' | 'unsupported' | 'denied' | 'failed'

const b64 = (s: string) => {
  const pad = '='.repeat((4 - (s.length % 4)) % 4)
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

export const pushSupported = () =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

export async function enablePush(ref: TripRef): Promise<PushResult> {
  if (!pushSupported()) return 'unsupported'
  try {
    const perm = await Notification.requestPermission()
    if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'failed'
    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('no service worker')), 4000)),
    ])
    const { public_key } = await api.pushKey()
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(public_key) }))
    await api.patchTrip(ref, { push: sub.toJSON() })
    return 'ok'
  } catch {
    return 'failed'
  }
}
