export type PushResult = 'ok' | 'unsupported' | 'denied' | 'failed'

export const pushSupported = () => 'Notification' in window

// Local notifications only: watchTrip shows them while Kurt is open. Server push is blocked.
export async function enableAlerts(): Promise<PushResult> {
  if (!pushSupported()) return 'unsupported'
  try {
    const perm = await Notification.requestPermission()
    return perm === 'granted' ? 'ok' : perm === 'denied' ? 'denied' : 'failed'
  } catch {
    return 'failed'
  }
}
