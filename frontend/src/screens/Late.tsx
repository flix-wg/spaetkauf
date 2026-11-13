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
      {/* Desktop: the count stays on the left while the list scrolls on the right. */}
      <div className={`flex flex-col gap-3 px-4 pb-8 lg:px-10 lg:pb-12 ${d?.checked_at ? 'lg:grid lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)] lg:items-start lg:gap-x-10' : ''}`}>
        {s.status === 'loading' && <Loading label="Kurt is reading the boards…" />}
        {s.status === 'error' && <ErrorState error={s.error} retry={retry} />}
        {d && !d.checked_at && (
          <Empty title="First board check is running" action={<button type="button" onClick={retry} className="btn-ghost">Refresh</button>}>
            Kurt reads the arrival boards of 12 big stations every few minutes. The first list appears shortly.
          </Empty>
        )}
        {d?.checked_at && (
          <>
            <section className={`${d.stale ? 'bg-surface' : 'bg-accent on-accent'} flex flex-col gap-1 rounded-[22px] p-4 lg:sticky lg:top-24 lg:gap-3 lg:rounded-[28px] lg:p-7`}>
              <h2 className="font-display text-[24px] font-bold leading-tight lg:text-[38px] lg:leading-[1.1]">
                <span className="mono">{list.length}</span> of <span className="mono">{d.checked}</span> trains: ticket unlocked right now
              </h2>
              <p className="flex items-center gap-1.5 text-[13px] lg:text-[16px]">
                <IconClock size={15} /> Checked {timeAgo(d.checked_at)} ({hhmm(d.checked_at)})
              </p>
              {d.stale && (
                <p className="rounded-lg bg-white px-3 py-2 text-[13px] font-semibold lg:text-[15px]" role="alert">
                  Not current: the live source failed, this is the last list Kurt got.
                </p>
              )}
            </section>
            <div className="contents lg:flex lg:flex-col lg:gap-4">
              {list.length === 0 ? (
                <Empty title="Nothing is 20+ minutes late">Kurt checked {d.checked} trains and found none. Check back in a few minutes.</Empty>
              ) : (
                <ul className="flex flex-col 2xl:grid 2xl:grid-cols-2 2xl:gap-x-10">
                  {list.map((t) => (
                    <li key={t.train + t.station} className="flex min-h-[64px] items-center justify-between gap-3 border-b border-line py-2.5 lg:min-h-[80px] lg:py-3">
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-[15px] font-bold lg:text-[19px]">
                          {t.train}
                          {stopName(t.headsign) && <span className="font-normal text-muted"> to {stopName(t.headsign)}</span>}
                        </span>
                        <span className="mono truncate text-[12px] text-muted lg:text-[15px]">
                          {t.station} · {hhmm(t.sched)} → {hhmm(t.expected)}
                        </span>
                      </span>
                      <Flap size="sm" text={`+${t.delay_min}`} label={`plus ${t.delay_min} minutes`} />
                    </li>
                  ))}
                </ul>
              )}
              <button type="button" onClick={retry} className="btn-ghost lg:self-start lg:px-8">Refresh</button>
            </div>
          </>
        )}
      </div>
    </>
  )
}
