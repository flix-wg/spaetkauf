import { tr, useT } from '../i18n'

const LINKEDIN = import.meta.env.VITE_OPERATOR_LINKEDIN

// A feature that needs an always-on server, which the static Kurt doesn't have.
export function Interested({ feature }: { feature: 'push' | 'signals' | 'background' }) {
  useT()
  const what = { push: tr('interestedPush'), signals: tr('interestedSignals'), background: tr('interestedBackground') }[feature]
  return (
    <p className="rounded-2xl bg-surface p-3.5 text-[13px] leading-snug text-muted lg:text-[15px]" data-interested={feature}>
      <b className="text-ink">{what}.</b> {tr('needsAServer')}{' '}
      {LINKEDIN && (
        <a href={LINKEDIN} target="_blank" rel="noopener noreferrer" className="font-semibold text-ink underline">{tr('interestedMessageMe')}</a>
      )}
    </p>
  )
}
