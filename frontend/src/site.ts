// Text that has to be in the HTML before any JavaScript runs: per-page meta, the landing copy with its FAQ,
// and the legal pages. The build writes it into static pages (vite.config.ts); the app renders the same text.
import { de, en, type Lang } from './i18n-core.ts'
export { pathLang } from './i18n-core.ts'

export const ORIGIN = 'https://kurtfaehrt.de'
export const REPO = 'https://github.com/flix-wg/spaetkauf'

export interface Operator { name: string; address: string[]; email: string; hosting?: string }

export const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export const landingPath = (lang: Lang) => (lang === 'de' ? '/' : '/en/')

export const META = {
  de: {
    title: 'Kurt: Günstiger Bahn fahren mit Zügen, die oft zu spät sind',
    description:
      'Kurt zeigt, wie oft ein ICE oder IC 20+ Minuten zu spät war. Buch den Sparpreis für den Zug, der meist zu spät ist, und fahr mit dem besseren. Kostenlos.',
  },
  en: {
    title: 'Kurt: Cheaper German train tickets from trains that run late',
    description:
      'Kurt shows how often each ICE or IC in Germany arrived 20+ min late. Buy the cheap Sparpreis for the train that’s usually late and ride a better one. Free.',
  },
}

export const COPY = {
  de: {
    h1: 'Günstiger Bahn fahren mit Zügen, die oft zu spät sind',
    intro:
      'Kurt ist eine kostenlose Web-App für Fernzüge in Deutschland. Sie zeigt für jeden ICE, IC und EC, wie oft er im vergangenen Jahr 20 Minuten oder mehr zu spät am Ziel ankam. Ab 20 Minuten Verspätung gilt dein Sparpreis auch in anderen Zügen. Also buchst du den günstigen Zug, der oft zu spät ist, und fährst mit dem besseren.',
    how: 'So funktioniert Kurt',
    faq: 'Häufige Fragen',
    other: 'Kurt in English',
    open: 'Kurt öffnen',
  },
  en: {
    h1: 'Cheaper German train tickets from trains that run late',
    intro:
      'Kurt is a free web app for long-distance trains in Germany. For every ICE, IC and EC it shows how often the train arrived 20 minutes or more late over the past year. Once a train is 20+ minutes late, your Sparpreis ticket is valid on other trains too. So you book the cheap train that’s often late and ride the better one.',
    how: 'How Kurt works',
    faq: 'Questions and answers',
    other: 'Kurt auf Deutsch',
    open: 'Open Kurt',
  },
}

export const FAQ: Record<Lang, [string, string][]> = {
  de: [
    ['Was ist Kurt?',
      'Kurt ist eine kostenlose Web-App für Bahnreisen in Deutschland. Kurt zeigt, wie oft ein Fernzug früher 20 Minuten oder mehr zu spät an deinem Ziel ankam, und beobachtet deine gebuchte Fahrt live. Kurt gehört nicht zur Deutschen Bahn und arbeitet nicht mit ihr zusammen.'],
    ['Wie spare ich mit einem Zug, der oft zu spät ist?',
      'Ist dein Zug voraussichtlich 20 Minuten oder mehr zu spät an deinem Ziel, ist die Zugbindung aufgehoben. Dein Sparpreis oder Super Sparpreis gilt dann auch in anderen Zügen auf der Strecke, außer in reservierungspflichtigen. Du buchst also das günstige Ticket für den Zug, der oft zu spät ist, und nimmst im Zweifel einen schnelleren oder bequemeren. Eine Verspätung, die beim Buchen schon angekündigt war, zählt nicht.'],
    ['Wann bekomme ich Geld zurück?',
      'Ab 60 Minuten Verspätung am Ziel bekommst du 25 % des Fahrpreises zurück, ab 120 Minuten 50 %. Steht schon vor der Abfahrt fest, dass du 60 Minuten oder mehr zu spät ankommst, kannst du auf die Reise verzichten und bekommst den ganzen Fahrpreis zurück. Beträge unter 4 € zahlt die Bahn nicht aus. Den Antrag stellst du selbst bei der Bahn.'],
    ['Woher hat Kurt die Zahlen?',
      'Aus den Ankunftsdaten der Deutschen Bahn des vergangenen Jahres, gesammelt vom Projekt piebro/deutsche-bahn-data (Lizenz CC BY 4.0). Kurt zählt pro Zug und Halt, wie oft der Zug 20 Minuten oder mehr zu spät war. Fahrpläne und Echtzeitdaten kommen von Transitous.'],
    ['Für welche Züge gilt das?',
      'Für Fernzüge in Deutschland: ICE, IC und EC an gut 400 großen Bahnhöfen, für die es Verspätungsdaten gibt. Regionalzüge zählt Kurt nicht.'],
    ['Ist die Verspätung garantiert?',
      'Nein. Kurt zeigt, wie es früher war. Ein Zug mit hoher Quote kann heute pünktlich sein. Dann kommst du eben pünktlich an, mit dem günstigen Ticket.'],
    ['Was kostet Kurt?',
      'Nichts. Kurt hat keine Werbung, kein Konto und setzt keine Cookies. Gespeicherte Fahrten bleiben in deinem Browser. Der Quellcode ist offen auf GitHub.'],
    ['Gibt es Kurt direkt auf bahn.de?',
      'Ja, als Erweiterung für Chrome. Sie zeigt die Verspätungsquote neben jedem Zug in den Suchergebnissen auf bahn.de. Du findest sie im Chrome Web Store unter „Kurt: Verspätungschancen“.'],
  ],
  en: [
    ['What is Kurt?',
      'Kurt is a free web app for train travel in Germany. It shows how often a long-distance train arrived 20 minutes or more late at your stop in the past, and watches your booked trip live. Kurt is not part of Deutsche Bahn and doesn’t work with it.'],
    ['How do I save money with a train that’s often late?',
      'When your train is expected to reach your destination 20 minutes or more late, the train-specific booking (Zugbindung) no longer applies. Your Sparpreis or Super Sparpreis ticket is then valid on other trains on that route, except reservation-only ones. So you buy the cheap ticket for the train that’s often late, and when it is, you take a faster or more comfortable one. A delay already announced when you book doesn’t count.'],
    ['When do I get money back?',
      'At 60 minutes late at your destination you get 25 % of the fare back, at 120 minutes 50 %. If you know before you set off that you’ll be 60 minutes or more late, you can skip the trip and get the full fare back. Deutsche Bahn doesn’t pay out amounts under 4 €. You claim it from Deutsche Bahn yourself.'],
    ['Where do Kurt’s numbers come from?',
      'From Deutsche Bahn arrival data for the past year, collected by the piebro/deutsche-bahn-data project (licence CC BY 4.0). For each train and stop, Kurt counts how often the train was 20 minutes or more late. Timetables and live data come from Transitous.'],
    ['Which trains does it cover?',
      'Long-distance trains in Germany: ICE, IC and EC at just over 400 major stations with delay data. Kurt doesn’t cover regional trains.'],
    ['Is the delay guaranteed?',
      'No. Kurt shows what happened before. A train with a high rate can be on time today. Then you simply arrive on time, on the cheap ticket.'],
    ['What does Kurt cost?',
      'Nothing. Kurt has no ads, no account and sets no cookies. Saved trips stay in your browser. The source code is open on GitHub.'],
    ['Is Kurt available on bahn.de?',
      'Yes, as a Chrome extension. It shows the delay rate next to each train in the search results on bahn.de. Find it in the Chrome Web Store as “Kurt: late-train odds”.'],
  ],
}

const t = (lang: Lang) => (lang === 'de' ? de : en)

export function landingHtml(lang: Lang) {
  const m = t(lang), c = COPY[lang], other: Lang = lang === 'de' ? 'en' : 'de'
  const steps = [m.searchYourRouteKurtShowsHowOften, m.bookTheCheapestTicketBoundToThat, m.kurtWatchesItLiveAndTellsYou]
  const rules = [[m['20Min'], m.yourSaverTicketIsValidOnOther], [m['60Min'], m['25OfTheFareBackKnownBefore']], [m['120Min'], m['50OfTheFareBack']]]
  return `<div class="seo">
<header><a href="${landingPath(lang)}"><b>Kurt</b></a> · <a href="${landingPath(other)}" hreflang="${other}" lang="${other}">${esc(c.other)}</a></header>
<main>
<h1>${esc(c.h1)}</h1>
<p>${esc(c.intro)}</p>
<h2>${esc(c.how)}</h2>
<ol>${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
<p>${esc(m.skipTheFlexpreisItCostsMoreAnd)}</p>
<h2>${esc(m.whatADelayGetsYou)}</h2>
<ul>${rules.map(([d, w]) => `<li><b>${esc(d)}</b>: ${esc(w)}</li>`).join('')}</ul>
<p>${esc(m.lateMeansExpectedOrActualAtYour + m.amountsUnder4AreNotPaidNo)}</p>
<h2>${esc(c.faq)}</h2>
${FAQ[lang].map(([q, a]) => `<h3>${esc(q)}</h3>\n<p>${esc(a)}</p>`).join('\n')}
</main>
${footerHtml(lang)}
</div>`
}

function footerHtml(lang: Lang) {
  const m = t(lang)
  return `<footer><a href="${REPO}">${esc(m.quellcode)}</a> · <a href="/impressum">Impressum</a> · <a href="/datenschutz">Datenschutz</a></footer>`
}

function operatorHtml(d: Operator) {
  if (!d.name && !d.address.length && !d.email)
    return '<p>Die Betreiberangaben fehlen. Wer Kurt selbst betreibt, setzt sie beim Build (VITE_OPERATOR_NAME, VITE_OPERATOR_ADDRESS, VITE_OPERATOR_EMAIL).</p>'
  return `<p>${d.name ? `${esc(d.name)}<br>` : ''}${d.address.map((line) => `${esc(line)}<br>`).join('')}E-Mail: <a href="mailto:${esc(d.email)}">${esc(d.email)}</a></p>`
}

export type LegalPage = 'impressum' | 'datenschutz'

// The legal text is German only; the app adds a one-line note in English.
export function legalHtml(page: LegalPage, d: Operator) {
  const list = 'class="list-disc space-y-3 pl-5"'
  if (page === 'impressum') return `<h2>Anbieter</h2>
${operatorHtml(d)}
<h2>Über Kurt</h2>
<p>Kurt ist ein privates, nicht-kommerzielles Open-Source-Projekt, entstanden beim Hackathon Junction 2026. Kurt gehört nicht zur Deutschen Bahn und arbeitet nicht mit ihr zusammen. Tickets kaufst du bei der Bahn, Entschädigungen beantragst du dort selbst.</p>
<p>Kurt schätzt Verspätungen aus vergangenen Daten. Das ist keine Garantie: Ein Zug kann pünktlich sein, auch wenn Kurt eine hohe Quote zeigt. Alle Angaben ohne Gewähr.</p>
<p>Quellcode: <a href="${REPO}">github.com/flix-wg/spaetkauf</a></p>
<h2>Daten</h2>
<ul ${list}><li>Fahrpläne und Echtzeit: <a href="https://transitous.org/sources/">Transitous und seine Datenquellen</a>, Kartendaten © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap-Mitwirkende</a>.</li>
<li>Verspätungsstatistik: Deutsche Bahn (DB InfraGO, Timetables-API), über <a href="https://github.com/piebro/deutsche-bahn-data">piebro/deutsche-bahn-data</a>, Lizenz <a href="https://creativecommons.org/licenses/by/4.0/deed.de">CC BY 4.0</a>. Kurt hat die Daten zu Quoten pro Zug und Strecke zusammengefasst.</li></ul>`
  return `<p>Stand: 16. November 2026</p>
<h2>Verantwortlich</h2>
${operatorHtml(d)}
<h2>Was verarbeitet wird</h2>
<ul ${list}>
<li><b>Hosting:</b> ${esc(d.hosting ?? 'Cloudflare Pages')} (Cloudflare, Inc.) liefert die Seite aus und verarbeitet dabei deine IP-Adresse und technische Anfragedaten.</li>
<li><b>Suche und Echtzeitdaten:</b> Dein Browser fragt direkt bei Transitous (api.transitous.org) an. Transitous erhält deine IP-Adresse und die Suchangaben (Bahnhöfe, Datum, Uhrzeit).</li>
<li><b>Statistik:</b> Cloudflare Web Analytics zählt Seitenaufrufe und Ladezeiten, ohne Cookies und ohne etwas auf deinem Gerät zu speichern. Wir sehen nur zusammengefasste Zahlen.</li>
<li><b>Chrome-Erweiterung (optional):</b> Sie lädt Zugdateien von der Kurt-Seite (oder deinem eigenen Server); diese sieht deine IP-Adresse und welche Züge du ansiehst. An Transitous gehen Start, Ziel, Datum, Uhrzeit, deine IP-Adresse und eine Kennung der Erweiterung, die für alle gleich ist. Einstellungen gleicht Google bei aktiver Chrome-Synchronisierung ab.</li>
</ul>
<p>Rechtsgrundlage ist jeweils Art. 6 Abs. 1 lit. f DSGVO (Bereitstellung und Verbesserung von Website und Erweiterung). Cloudflare ist unser Auftragsverarbeiter; Übermittlungen in die USA erfolgen nach dem EU-US Data Privacy Framework. Wir selbst speichern keine dieser Daten; Cloudflare löscht sie, sobald sie für Betrieb und Sicherheit nicht mehr nötig sind. Transitous ist ein eigenständiger Anbieter; seine Speicherdauer kontrollieren wir nicht.</p>
<h2>Auf deinem Gerät</h2>
<p>Kurt setzt keine Cookies und hat kein Konto. Gespeicherte Fahrten, Einstellungen und Zwischenspeicher liegen nur im Speicher deines Browsers (§ 25 Abs. 2 Nr. 2 TDDDG) und gehen nicht an uns. Du löschst sie in der App oder über deinen Browser.</p>
<h2>Deine Rechte</h2>
<p>Du hast das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit und Widerspruch. Schreib dafür an die oben genannte E-Mail-Adresse. Du kannst dich bei einer Datenschutz-Aufsichtsbehörde beschweren.</p>`
}

export function legalPageHtml(page: LegalPage, d: Operator) {
  return `<div class="seo">
<header><a href="/"><b>Kurt</b></a></header>
<main lang="de">
<h1>${page === 'impressum' ? 'Impressum' : 'Datenschutzerklärung'}</h1>
${legalHtml(page, d)}
</main>
${footerHtml('de')}
</div>`
}

export function jsonLd(lang: Lang) {
  const url = ORIGIN + landingPath(lang)
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebApplication',
        '@id': `${url}#app`,
        name: 'Kurt',
        url,
        description: META[lang].description,
        inLanguage: lang,
        applicationCategory: 'TravelApplication',
        operatingSystem: 'Web',
        isAccessibleForFree: true,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
        image: `${ORIGIN}/og${lang === 'de' ? '' : '-en'}.png`,
        sameAs: [REPO],
      },
      {
        '@type': 'FAQPage',
        '@id': `${url}#faq`,
        inLanguage: lang,
        mainEntity: FAQ[lang].map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
      },
    ],
  }
}

export const LLMS_TXT = `# Kurt

> Kurt (kurtfaehrt.de) is a free web app for long-distance trains in Germany. It shows how often each ICE, IC and EC arrived 20+ minutes late over the past year, so you can buy the cheap train-bound Sparpreis ticket for a train that is usually late and ride a better one once it is. Kurt is independent and not part of Deutsche Bahn.

The rules Kurt builds on (Deutsche Bahn passenger rights for national trips):

- 20+ min expected delay at the destination: the train-specific booking (Zugbindung) no longer applies, so a Sparpreis or Super Sparpreis ticket is valid on other trains on the route, except reservation-only ones. A delay already announced at booking doesn't count.
- 60+ min late: 25 % of the fare back. If the delay is known before departure, you can skip the trip for a full refund.
- 120+ min late: 50 % of the fare back. Amounts under 4 € are not paid out.

Data: Deutsche Bahn arrival data via piebro/deutsche-bahn-data (CC BY 4.0), timetables and live data via Transitous. Past delay rates are no guarantee.

## Pages

- [Kurt (Deutsch)](${ORIGIN}/): what Kurt does, how it works, FAQ in German
- [Kurt (English)](${ORIGIN}/en/): the same in English
- [Impressum](${ORIGIN}/impressum): operator and data sources
- [Datenschutz](${ORIGIN}/datenschutz): privacy policy

## Optional

- [Source code](${REPO}): open source on GitHub
`
