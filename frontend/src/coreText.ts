import { getLang } from './i18n-core.ts'

// German for the English text the core returns, ported from backend i18n.py (strings the static core can produce).
const STRINGS: Record<string, string> = {
  'Deutsche Bahn arrival data via piebro/deutsche-bahn-data, CC BY 4.0': 'Ankunftsdaten der Deutschen Bahn über piebro/deutsche-bahn-data, CC BY 4.0',
  'Ticket unlocked': 'Zugbindung aufgehoben',
  '25 % back': '25 % zurück',
  '50 % back': '50 % zurück',
  'Date': 'Datum',
  'Train': 'Zug',
  'From': 'Von',
  'To': 'Nach',
  'Scheduled arrival': 'Planmäßige Ankunft',
  'Expected arrival': 'Erwartete Ankunft',
  'Actual arrival': 'Tatsächliche Ankunft',
  'Delay': 'Verspätung',
  'No delay recorded yet.': 'Noch keine Verspätung erfasst.',
  'No long-distance connections found; try another date or station.': 'Keine Fernverbindungen gefunden. Probier ein anderes Datum oder einen anderen Bahnhof.',
  'The delay was already posted when you booked; no compensation is due.': 'Die Verspätung war beim Buchen schon bekannt. Du hast keinen Entschädigungsanspruch.',
  'Real-time data from Transitous, not DB\'s own record.': 'Echtzeitdaten von Transitous, keine eigene Aufzeichnung der DB.',
  'File it yourself with DB: online at bahn.de (Fahrgastrechte), in the DB Navigator app or at a DB travel centre. This app never submits a claim.':
    'Den Antrag stellst du selbst bei der DB: online auf bahn.de (Fahrgastrechte), im DB Navigator oder im DB-Reisezentrum. Kurt reicht nichts für dich ein.',
  'You switched trains: compensation depends on your actual arrival on the train you took. If you arrived under 60 minutes late, nothing is owed; 60–119 minutes gives 25 % of the ticket price, 120+ gives 50 % (minimum payout 4 EUR). Fill in your actual arrival yourself.':
    'Du bist umgestiegen: Für die Entschädigung zählt deine tatsächliche Ankunft. Unter 60 Minuten gibt es nichts, bei 60–119 Minuten 25 % des Ticketpreises, ab 120 Minuten 50 % (Mindestbetrag 4 €). Trage deine tatsächliche Ankunft selbst ein.',
  'Date is in the past': 'Das Datum liegt in der Vergangenheit',
  'time must be HH:MM': 'Gib die Uhrzeit als HH:MM ein',
  'time (latest arrival, HH:MM) is required with mode=arrive': 'Gib die späteste Ankunft als HH:MM ein',
  'Run history unavailable': 'Vergangene Fahrten sind gerade nicht verfügbar',
  'Odds table unavailable': 'Verspätungsstatistiken sind gerade nicht verfügbar',
  'No backtest available': 'Keine Auswertung verfügbar',
  'weekday must be between 0 and 6': 'Der Wochentag muss zwischen 0 und 6 liegen',
}
const money = (value: string) => `${Number(value).toFixed(2).replace('.', ',')} €`
const PATTERNS: [RegExp, (m: RegExpExecArray) => string][] = [
  [/^Timetables only cover (.*) to (.*)\. Pick a date in that range$/, m => `Fahrpläne reichen nur von ${m[1]} bis ${m[2]}. Wähle ein Datum in diesem Zeitraum`],
  [/^(\d+) of (\d+) connections have too little history for odds(.*)\.$/, m =>
    `${m[1]} von ${m[2]} Verbindungen haben zu wenige vergangene Fahrten für eine Chance${m[3] ? ' (keine Daten für FlixTrain-Abschnitte)' : ''}.`],
  [/^Under 60 minutes late \((-?\d+) min\): no compensation is due\.$/, m => `Unter 60 Minuten verspätet (${m[1]} Min.): keine Entschädigung.`],
  [/^(\d+) % of the ticket price is owed\. Enter the price to see the amount\.$/, m => `Du hast Anspruch auf ${m[1]} % des Ticketpreises. Gib den Preis für den Betrag ein.`],
  [/^(\d+) min late: (\d+) % of ([\d.]+) EUR, rounded up to 5 cents\.$/, m => `${m[1]} Min. verspätet: ${m[2]} % von ${money(m[3])}, auf 5 Cent aufgerundet.`],
  [/^(\d+) % would be ([\d.]+) EUR; DB pays nothing under 4.00 EUR\. .*$/, m => `${m[1]} % wären ${money(m[2])}; unter 4,00 € zahlt die DB nichts aus. ` +
    'Die aufgehobene Zugbindung ab 20 Minuten und die volle Erstattung bei Reiseverzicht ab erwarteten 60 Minuten gelten trotzdem.'],
  [/^Unknown station: (.*)$/, m => `Unbekannter Bahnhof: ${m[1]}`],
  [/^No history for (.*)$/, m => `Keine vergangenen Fahrten für ${m[1]}`],
  [/^'(.*)' is not a train like 'ICE 1103'$/, m => `„${m[1]}“ ist keine Zugnummer wie „ICE 1103“`],
  [/^'(.*)' is not a stop (.*)$/, m => `„${m[1]}“ ist kein Halt ${m[2].replaceAll('of ', 'von ').replaceAll('stops:', 'Halte:')}`],
  [/^The history covers (.*) to (.*), not (.*)$/, m => `Die Daten reichen von ${m[1]} bis ${m[2]}, nicht bis ${m[3]}`],
]

export function text(value: string): string {
  if (getLang() !== 'de') return value
  if (value in STRINGS) return STRINGS[value]
  for (const [pattern, render] of PATTERNS) {
    const match = pattern.exec(value)
    if (match) return render(match)
  }
  return value
}
const KEYS = new Set(['label', 'note', 'reason', 'where', 'source'])
export function localize<T>(value: T): T {
  if (getLang() !== 'de') return value
  if (Array.isArray(value)) return value.map(localize) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, KEYS.has(k) && typeof v === 'string' ? text(v) : localize(v)])) as T
  }
  return value
}
