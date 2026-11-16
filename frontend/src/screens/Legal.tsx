import { useT } from '../i18n'
import { api, type LegalInfo } from '../api'
import { ScreenHeader } from '../components/Shell'
import { ErrorState, Loading } from '../components/States'
import { useAsync } from '../hooks'

function Operator({ data }: { data: LegalInfo }) {
  if (!data.name && !data.address.length && !data.email) return <p>Die Betreiberangaben fehlen. Wer Kurt selbst betreibt, setzt sie beim Build (VITE_OPERATOR_NAME, VITE_OPERATOR_ADDRESS, VITE_OPERATOR_EMAIL).</p>
  return <p>{data.name && <>{data.name}<br /></>}{data.address.map((line, i) => <span key={i}>{line}<br /></span>)}E-Mail: <a href={`mailto:${data.email}`}>{data.email}</a></p>
}

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
      {d && (page === 'impressum' ? <>
        <h2>Anbieter</h2>
        <Operator data={d} />
        <h2>Über Kurt</h2>
        <p>Kurt ist ein privates, nicht-kommerzielles Open-Source-Projekt, entstanden beim Hackathon Junction 2026. Kurt gehört nicht zur Deutschen Bahn und arbeitet nicht mit ihr zusammen. Tickets kaufst du bei der Bahn, Entschädigungen beantragst du dort selbst.</p>
        <p>Kurt schätzt Verspätungen aus vergangenen Daten. Das ist keine Garantie: Ein Zug kann pünktlich sein, auch wenn Kurt eine hohe Quote zeigt. Alle Angaben ohne Gewähr.</p>
        <p>Quellcode: <a href="https://github.com/flix-wg/spaetkauf">github.com/flix-wg/spaetkauf</a></p>
        <h2>Daten</h2>
        <ul className="list-disc space-y-3 pl-5"><li>Fahrpläne und Echtzeit: <a href="https://transitous.org/sources/">Transitous und seine Datenquellen</a>, Kartendaten © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap-Mitwirkende</a>.</li>
        <li>Verspätungsstatistik: Deutsche Bahn (DB InfraGO, Timetables-API), über <a href="https://github.com/piebro/deutsche-bahn-data">piebro/deutsche-bahn-data</a>, Lizenz <a href="https://creativecommons.org/licenses/by/4.0/deed.de">CC BY 4.0</a>. Kurt hat die Daten zu Quoten pro Zug und Strecke zusammengefasst.</li></ul>
</> : <>
        <p>Stand: 16. November 2026</p>
        <h2>Verantwortlich</h2>
        <Operator data={d} />
        <h2>Was verarbeitet wird</h2>
        <ul className="list-disc space-y-3 pl-5">
          <li><b>Hosting:</b> {d.hosting} (Cloudflare, Inc.) liefert die Seite aus und verarbeitet dabei deine IP-Adresse und technische Anfragedaten.</li>
          <li><b>Suche und Echtzeitdaten:</b> Dein Browser fragt direkt bei Transitous (api.transitous.org) an. Transitous erhält deine IP-Adresse und die Suchangaben (Bahnhöfe, Datum, Uhrzeit).</li>
          <li><b>Statistik:</b> Cloudflare Web Analytics zählt Seitenaufrufe und Ladezeiten, ohne Cookies und ohne etwas auf deinem Gerät zu speichern. Wir sehen nur zusammengefasste Zahlen.</li>
          <li><b>Chrome-Erweiterung (optional):</b> Sie lädt Zugdateien von der eingestellten Kurt-Seite und schickt Start, Ziel, Datum und Abfahrtszeit an Transitous. Ihre Einstellungen gleicht Google bei aktiver Chrome-Synchronisierung ab.</li>
        </ul>
        <p>Rechtsgrundlage ist jeweils Art. 6 Abs. 1 lit. f DSGVO (Bereitstellung und Verbesserung der Website). Cloudflare ist unser Auftragsverarbeiter; Übermittlungen in die USA erfolgen nach dem EU-US Data Privacy Framework. Wir selbst speichern keine dieser Daten; Cloudflare und Transitous löschen sie, sobald sie für Betrieb und Sicherheit nicht mehr nötig sind.</p>
        <h2>Auf deinem Gerät</h2>
        <p>Kurt setzt keine Cookies und hat kein Konto. Gespeicherte Fahrten, Einstellungen und Zwischenspeicher liegen nur im Speicher deines Browsers (§ 25 Abs. 2 Nr. 2 TDDDG) und gehen nicht an uns. Du löschst sie in der App oder über deinen Browser.</p>
        <h2>Deine Rechte</h2>
        <p>Du hast das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit und Widerspruch. Schreib dafür an die oben genannte E-Mail-Adresse. Du kannst dich bei einer Datenschutz-Aufsichtsbehörde beschweren.</p>
</>)}
    </article>
  </>
}
