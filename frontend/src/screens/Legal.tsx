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
        <h2>Kurz gesagt</h2>
        <p>Kurt braucht kein Konto, setzt keine Cookies, zeigt keine Werbung und verfolgt dich nicht über andere Websites. Wie oft Kurt genutzt wird und wie schnell es lädt, sehen wir nur als zusammengefasste Zahlen (siehe Web Analytics). Kurt hat keinen eigenen Server: Die Seite besteht aus festen Dateien, gerechnet wird in deinem Browser. Gespeicherte Fahrten bleiben auf deinem Gerät.</p>
        <h2>Verantwortlich</h2>
        <Operator data={d} />
        <h2>Hosting</h2>
        <p>Die Dateien liegen bei {d.hosting} (Cloudflare, Inc., USA). Wenn du die Seite aufrufst, sieht Cloudflare technisch bedingt deine IP-Adresse und die aufgerufene Adresse. Cloudflare ist nach dem EU-US Data Privacy Framework zertifiziert. Cloudflare verarbeitet diese Daten als unser Auftragsverarbeiter. Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO (schnelle und sichere Auslieferung). Mehr: <a href="https://www.cloudflare.com/privacypolicy/">cloudflare.com/privacypolicy</a>.</p>
        <h2>Suche und Echtzeitdaten</h2>
        <p>Wenn du eine Verbindung suchst, fragt dein Browser direkt bei Transitous (transitous.org) nach Bahnhöfen, Zügen und Echtzeitdaten. Transitous sieht dabei deine IP-Adresse, deine Eingabe im Bahnhofsfeld, Bahnhöfe, Datum und Uhrzeit sowie die Adresse dieser Website (ohne die aufgerufene Seite). Dasselbe gilt für „Jetzt verspätet“ (Ankunftstafeln von 12 großen Bahnhöfen) und für gespeicherte Fahrten, solange Kurt geöffnet ist. Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO (die Suche soll funktionieren).</p>
        <p>Die Verspätungsstatistik lädt dein Browser als Dateien von dieser Website. Kurt fragt nie bei bahn.de oder anderen Diensten der Deutschen Bahn an.</p>
        <h2>Gespeicherte Fahrten</h2>
        <p>Eine gespeicherte Fahrt liegt nur im Speicher deines Browsers: die Verbindung (Züge, Bahnhöfe, Zeiten), auf Wunsch der Ticketpreis und die Verspätungsstände, die Kurt gesehen hat, während die Seite offen war. Nichts davon geht an uns. Du löschst sie in der App oder über die Website-Daten deines Browsers.</p>
        <h2>Benachrichtigungen</h2>
        <p>Wenn du Benachrichtigungen erlaubst, zeigt dein Browser sie selbst an, solange Kurt geöffnet ist. Es gibt keinen Push-Dienst und keinen Server, der dir schreibt.</p>
        <h2>Speicher auf deinem Gerät</h2>
        <p>Kurt setzt keine Cookies. Im Speicher deines Browsers (localStorage und sessionStorage) liegen nur: deine gespeicherten Fahrten, ein paar Einstellungen (etwa ob du schon die Einführung gesehen hast, deine Sprache und helles/dunkles Design), deine letzte Suche, zwischengespeicherte Antworten von Transitous und ein Zähler, wie oft Kurt heute Verbindungen gesucht hat. Damit die App auch offline startet, legt der Service Worker die Programmdateien und Verspätungsdaten im Browser-Cache ab. Das dient nur dazu, dass die App und die Einstellungen funktionieren, die du gewählt hast; deshalb fragen wir nicht extra (§ 25 Abs. 2 Nr. 2 TDDDG). Löschen kannst du es über die Website-Daten in deinem Browser.</p>
        <h2>Chrome-Erweiterung (optional)</h2>
        <p>Die Erweiterung liest auf einer bahn.de-Ergebnisseite, die du selbst geöffnet hast, die angezeigten Verbindungen: Zeiten, Zugnummern und Bahnhöfe. Die Quoten berechnet sie selbst: Von der eingestellten Kurt-Seite lädt sie die Quoten-Dateien der angezeigten Züge, die Seite sieht also, welche Züge angefragt werden, und deine IP-Adresse. Um einen Umstieg wie die App zu werten, schickt sie Start, Ziel, Datum und Abfahrtszeit an Transitous (api.transitous.org); Transitous sieht dabei auch deine IP-Adresse und dass die Anfrage von der Kurt-Erweiterung kommt. Namen, Preise oder Kontodaten schickt sie nirgends hin. Sie klickt nichts an, füllt nichts aus und lädt nichts von bahn.de. Ihre Einstellungen (Adresse der Kurt-Seite, an/aus) liegen im Speicher deines Browsers; mit Chrome-Synchronisierung gleicht Google sie zwischen deinen Geräten ab. Wie viele Routenabfragen sie heute schon gemacht hat, merkt sie sich auf deinem Gerät.</p>
        <h2>Web Analytics</h2>
        <p>Wir nutzen Cloudflare Web Analytics, um zu sehen, wie viele Leute Kurt nutzen und wie schnell die Seiten laden. Dein Browser lädt dafür ein kleines Skript von static.cloudflareinsights.com und schickt beim Aufruf einer Seite Messwerte an cloudflareinsights.com: die aufgerufene Seite, die Seite, von der du kommst, Browser, Betriebssystem, Gerätetyp, Land und Ladezeiten. Deine IP-Adresse verwirft Cloudflare nach eigenen Angaben direkt im Rechenzentrum, sie wird nicht gespeichert. Wir sehen nur zusammengefasste Zahlen, keine einzelnen Besucher. Das Skript setzt keine Cookies, speichert nichts auf deinem Gerät und erstellt keinen Fingerabdruck deines Browsers; deshalb fragen wir nicht extra. Cloudflare verarbeitet die Daten als unser Auftragsverarbeiter, auch in den USA (EU-US Data Privacy Framework). Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO (wir wollen wissen, ob Kurt genutzt wird und schnell genug ist). Du kannst widersprechen, indem du das Skript mit einem Inhaltsblocker sperrst; Kurt funktioniert dann genauso.</p>
        <h2>Deine Rechte</h2>
        <p>Du hast das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit und Widerspruch. Schreib dafür an die oben genannte E-Mail-Adresse. Du kannst dich auch bei einer Datenschutz-Aufsichtsbehörde beschweren.</p>
</>)}
    </article>
  </>
}
