import { useT } from '../i18n'
import { api, type LegalInfo } from '../api'
import { ScreenHeader } from '../components/Shell'
import { ErrorState, Loading } from '../components/States'
import { useAsync } from '../hooks'

function Operator({ data }: { data: LegalInfo }) {
  if (!data.name && !data.address.length && !data.email) return <p>Die Betreiberangaben fehlen. Wer Kurt selbst betreibt, trägt sie in der .env ein (OPERATOR_NAME, OPERATOR_ADDRESS, OPERATOR_EMAIL).</p>
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
        <p>Stand: 15. November 2026</p>
        <h2>Kurz gesagt</h2>
        <p>Kurt braucht kein Konto, setzt keine Cookies, zeigt keine Werbung und misst nicht, was du tust. Mit deiner Person verbindet Kurt nichts. Auf dem Server liegt vor allem eine Fahrt, wenn du sie speicherst, damit Kurt sie beobachten kann.</p>
        <h2>Verantwortlich</h2>
        <Operator data={d} />
        <h2>Hosting</h2>
        <p>Der Server läuft bei {d.hosting || 'beim Hosting-Anbieter des Betreibers'}. Wenn du die Seite aufrufst, bekommt der Server technisch bedingt deine IP-Adresse, sonst könnte er nicht antworten. Er schreibt keine Zugriffsprotokolle. Fehlermeldungen des Webservers (etwa während eines Neustarts) enthalten nur eine gekürzte IP-Adresse, aber weder die aufgerufene Adresse noch andere Angaben deines Browsers. Das Protokoll ist auf 30 MB begrenzt; ältere Einträge werden dabei gelöscht. Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse am sicheren Betrieb).</p>
        {d.cdn === "cloudflare" && <>
        <h2>Cloudflare</h2>
        <p>Die Seite läuft über das Netz von Cloudflare, Inc. (USA). Cloudflare leitet jede Anfrage an unseren Server weiter und sieht dabei deine IP-Adresse und die aufgerufene Adresse. Cloudflare ist nach dem EU-US Data Privacy Framework zertifiziert. Wir haben keine Cloudflare-Funktionen eingeschaltet, die Cookies setzen. Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO (schnelle und sichere Auslieferung). Mehr: <a href="https://www.cloudflare.com/privacypolicy/">cloudflare.com/privacypolicy</a>.</p>
        </>}
        <h2>Suche</h2>
        <p>Wenn du eine Verbindung suchst, fragt unser Server bei Transitous (transitous.org) nach Zügen und Echtzeitdaten. Dabei gehen nur deine Eingabe im Bahnhofsfeld, Bahnhöfe, Datum und Uhrzeit raus, nicht deine IP-Adresse. Die Antworten speichert der Server bis zu 7 Tage zwischen, ohne Bezug zu dir.</p>
        <p>Für Hinweise auf Streiks, Baustellen oder Unwetter sucht unser Server bei Exa (Exa Labs, Inc., USA) nach Nachrichten zur Strecke. Auch dabei gehen nur Ortsnamen und Datum raus. Streikmeldungen von Gewerkschaftsseiten kommen über Context.dev; dorthin geht nichts von dir.</p>
        <p>Kurt fragt nie bei bahn.de oder anderen Diensten der Deutschen Bahn an.</p>
        <h2>Gespeicherte Fahrten</h2>
        <p>Wenn du eine Fahrt speicherst, merkt sich der Server: die Verbindung (Züge, Bahnhöfe, Zeiten), auf Wunsch den Ticketpreis, die Verspätungsstände der Fahrt und welche Hinweise schon verschickt wurden. Name, E-Mail oder Zahlungsdaten fragt Kurt nie ab.</p>
        <p>Die Fahrt hat eine Zufallsnummer und einen geheimen Schlüssel. Beides liegt auf deinem Gerät. Der Server kennt die Nummer, vom Schlüssel aber nur einen Hash. Ohne den Schlüssel kommt niemand an die Fahrt.</p>
        <p>Du kannst eine Fahrt jederzeit in der App löschen; dann ist sie auch auf dem Server weg. Sonst löscht der Server sie 30 Tage nach der Ankunft, spätestens ein Jahr nach dem Speichern. Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO (du nutzt eine Funktion, die du selbst angefragt hast).</p>
        <h2>Push-Nachrichten</h2>
        <p>Wenn du Benachrichtigungen erlaubst, speichert der Server die Push-Adresse deines Browsers bei der Fahrt. Die Nachrichten laufen über den Push-Dienst deines Browsers, zum Beispiel Google (Chrome), Mozilla (Firefox), Apple (Safari) oder Microsoft (Edge). Diese Dienste können Daten auch in den USA verarbeiten. Der Inhalt ist verschlüsselt; der Push-Dienst sieht nur, dass eine Nachricht kommt. Du kannst Benachrichtigungen in den Browser-Einstellungen abschalten oder die Fahrt löschen. Rechtsgrundlage: deine Einwilligung, Art. 6 Abs. 1 lit. a DSGVO; du kannst sie jederzeit widerrufen.</p>
        <h2>Speicher auf deinem Gerät</h2>
        <p>Kurt setzt keine Cookies. Im Speicher deines Browsers (localStorage und sessionStorage) liegen nur: die Liste deiner gespeicherten Fahrten mit Nummer und Schlüssel, ein paar Einstellungen (etwa ob du schon die Einführung gesehen hast, deine Sprache und helles/dunkles Design) und deine letzte Suche. Damit die App auch offline startet, legt der Service Worker die Programmdateien im Browser-Cache ab. Das alles ist nötig, damit die App funktioniert, deshalb fragen wir nicht extra (§ 25 Abs. 2 Nr. 2 TDDDG). Löschen kannst du es über die Website-Daten in deinem Browser.</p>
        <h2>Chrome-Erweiterung (optional)</h2>
        <p>Die Erweiterung liest auf einer bahn.de-Ergebnisseite, die du selbst geöffnet hast, die angezeigten Verbindungen: Zeiten, Zugnummern und Bahnhöfe. Diese schickt sie an den Kurt-Server und zeigt die Quoten auf der Seite an. Namen, Preise oder Kontodaten schickt sie nicht mit. Sie klickt nichts an, füllt nichts aus und lädt nichts von bahn.de. Ihre Einstellungen (Server-Adresse, an/aus) liegen im Speicher deines Browsers; mit Chrome-Synchronisierung gleicht Google sie zwischen deinen Geräten ab. Außerdem merkt sie sich auf deinem Gerät, wie sie die Ergebnisliste lesen kann.</p>
        {d.adapter && <p>Erkennt die Erweiterung eine bahn.de-Seite nicht, schickt sie ein Gerüst der Seite an den Kurt-Server: nur den Aufbau, ohne Texte, Namen oder Bahnhöfe. Der Server lässt dieses Gerüst von Anthropic (Anthropic, PBC, USA) auswerten, damit die Erweiterung die Verbindungen wiederfindet. Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO (die Erweiterung soll funktionieren).</p>}
        <h2>Deine Rechte</h2>
        <p>Du hast das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit und Widerspruch. Schreib dafür an die oben genannte E-Mail-Adresse. Du kannst dich auch bei einer Datenschutz-Aufsichtsbehörde beschweren.</p>
</>)}
    </article>
  </>
}
