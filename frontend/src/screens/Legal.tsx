import { useT } from '../i18n'
import { api } from '../api'
import { legalHtml } from '../site'
import { ScreenHeader } from '../components/Shell'
import { ErrorState, Loading } from '../components/States'
import { useAsync } from '../hooks'

export function Legal({ page }: { page: 'impressum' | 'datenschutz' }) {
  const { t, lang } = useT()
  const [s, retry] = useAsync(() => api.legal(), [])
  const d = s.status === 'ok' ? s.data : null
  return <>
    <ScreenHeader title={page === 'impressum' ? t.impressum : t.datenschutz} />
    {lang === 'en' && <p className="mx-auto max-w-[640px] px-5 pt-4 text-muted">{page === 'impressum' ? t.legalGerman : t.privacyGerman}</p>}
    <article lang="de" className="mx-auto max-w-[640px] space-y-5 px-5 pt-5 text-[16px] leading-relaxed text-ink [&_h2]:pt-3 [&_h2]:font-display [&_h2]:text-[22px] [&_h2]:font-bold [&_a]:break-words [&_a]:text-accent-text [&_a]:underline">
      {s.status === 'loading' && <Loading />}
      {s.status === 'error' && <ErrorState error={s.error} retry={retry} />}
      {d && <div dangerouslySetInnerHTML={{ __html: legalHtml(page, d) }} className="space-y-5" />}
    </article>
  </>
}
