import { api } from '../api'
import { Flap } from '../components/Flap'
import { IconClock } from '../components/Icons'
import { ScreenHeader } from '../components/Shell'
import { Empty, ErrorState, Loading } from '../components/States'
import { hhmm, stopName, timeAgo } from '../format'
import { useAsync } from '../hooks'

export function Late() {
  const [s, retry] = useAsync(() => api.lateNow(), [], 60000)
  const d = s.status === 'ok' ? s.data : null
  const list = d ? [...d.late].sort((a, b) => b.delay_min - a.delay_min) : []
  return (
    <>
      <ScreenHeader title="Late now" />
      <div className="flex flex-col gap-3 px-4 pb-8">
        {s.status === 'loading' && <Loading label="Kurt is reading the boards…" />}
        {s.status === 'error' && <ErrorState error={s.error} retry={retry} />}
        {d && !d.checked_at && (
          <Empty title="First board check is running" action={<button type="button" onClick={retry} className="btn-ghost">Refresh</button>}>
            Kurt reads the arrival boards of 12 big stations every few minutes. The first list appears shortly.
          </Empty>
        )}
        {d?.checked_at && (
          <>
            <section className={`${d.stale ? 'bg-surface' : 'bg-accent on-accent'} flex flex-col gap-1 rounded-[22px] p-4`}>
              <h2 className="font-display text-[24px] font-bold leading-tight">
                <span className="mono">{list.length}</span> of <span className="mono">{d.checked}</span> trains: ticket unlocked right now
              </h2>
              <p className="flex items-center gap-1.5 text-[13px]">
                <IconClock size={15} /> Checked {timeAgo(d.checked_at)} ({hhmm(d.checked_at)})
              </p>
              {d.stale && (
                <p className="rounded-lg bg-white px-3 py-2 text-[13px] font-semibold" role="alert">
                  Not current: the live source failed, this is the last list Kurt got.
                </p>
              )}
            </section>
            {list.length === 0 ? (
              <Empty title="Nothing is 20+ minutes late">Kurt checked {d.checked} trains and found none. Check back in a few minutes.</Empty>
            ) : (
              <ul className="flex flex-col">
                {list.map((t) => (
                  <li key={t.train + t.station} className="flex min-h-[64px] items-center justify-between gap-3 border-b border-line py-2.5">
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-[15px] font-bold">
                        {t.train}
                        {stopName(t.headsign) && <span className="font-normal text-muted"> to {stopName(t.headsign)}</span>}
                      </span>
                      <span className="mono truncate text-[12px] text-muted">
                        {t.station} · {hhmm(t.sched)} → {hhmm(t.expected)}
                      </span>
                    </span>
                    <Flap size="sm" text={`+${t.delay_min}`} label={`plus ${t.delay_min} minutes`} />
                  </li>
                ))}
              </ul>
            )}
            <button type="button" onClick={retry} className="btn-ghost">Refresh</button>
          </>
        )}
      </div>
    </>
  )
}
