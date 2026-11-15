"""Request language and the API's own display text; source quotations stay as published."""
import re

from fastapi import Request


def lang_from(request: Request) -> str:
    return "de" if request.headers.get("accept-language", "").lower().startswith("de") else "en"


STRINGS = {
    "Deutsche Bahn arrival data via piebro/deutsche-bahn-data, CC BY 4.0":
        "Ankunftsdaten der Deutschen Bahn über piebro/deutsche-bahn-data, CC BY 4.0",
    "Ticket unlocked": "Zugbindung aufgehoben",
    "25 % back": "25 % zurück",
    "50 % back": "50 % zurück",
    "Date": "Datum",
    "Train": "Zug",
    "From": "Von",
    "To": "Nach",
    "Scheduled arrival": "Planmäßige Ankunft",
    "Expected arrival": "Erwartete Ankunft",
    "Actual arrival": "Tatsächliche Ankunft",
    "Delay": "Verspätung",
    "No delay recorded yet.": "Noch keine Verspätung erfasst.",
    "No long-distance connections found; try another date or station.":
        "Keine Fernverbindungen gefunden. Probier ein anderes Datum oder einen anderen Bahnhof.",
    "The delay was already posted when you booked; no compensation is due.":
        "Die Verspätung war beim Buchen schon bekannt. Du hast keinen Entschädigungsanspruch.",
    "Real-time data from Transitous, not DB's own record.":
        "Echtzeitdaten von Transitous, keine eigene Aufzeichnung der DB.",
    "File it yourself with DB: online at bahn.de (Fahrgastrechte), in the DB Navigator app "
    "or at a DB travel centre. This app never submits a claim.":
        "Den Antrag stellst du selbst bei der DB: online auf bahn.de (Fahrgastrechte), "
        "im DB Navigator oder im DB-Reisezentrum. Kurt reicht nichts für dich ein.",
    "You switched trains: compensation depends on your actual arrival on the train "
    "you took. If you arrived under 60 minutes late, nothing is owed; "
    "60–119 minutes gives 25 % of the ticket price, 120+ gives 50 % "
    "(minimum payout 4 EUR). Fill in your actual arrival yourself.":
        "Du bist umgestiegen: Für die Entschädigung zählt deine tatsächliche Ankunft. "
        "Unter 60 Minuten gibt es nichts, bei 60–119 Minuten 25 % des Ticketpreises, "
        "ab 120 Minuten 50 % (Mindestbetrag 4 €). Trage deine tatsächliche Ankunft selbst ein.",
    "Date is in the past": "Das Datum liegt in der Vergangenheit",
    "time must be HH:MM": "Gib die Uhrzeit als HH:MM ein",
    "time (latest arrival, HH:MM) is required with mode=arrive":
        "Gib die späteste Ankunft als HH:MM ein",
    "date must be a valid YYYY-MM-DD": "Gib ein gültiges Datum als JJJJ-MM-TT ein",
    "Run history unavailable": "Vergangene Fahrten sind gerade nicht verfügbar",
    "Odds table unavailable": "Verspätungsstatistiken sind gerade nicht verfügbar",
    "No backtest available": "Keine Auswertung verfügbar",
    "Not Found": "Nicht gefunden",
    "Limit reached for today": "Das Limit für heute ist erreicht",
    "Live source unavailable": "Echtzeitquelle gerade nicht verfügbar",
}


def money(value: str | float) -> str:
    return f"{float(value):.2f}".replace(".", ",") + " €"


def text(value: str, lang: str) -> str:
    if lang != "de":
        return value
    if value in STRINGS:
        return STRINGS[value]
    patterns = [
        (r"Timetables only cover (.*) to (.*)\. Pick a date in that range",
         lambda m: f"Fahrpläne reichen nur von {m[1]} bis {m[2]}. Wähle ein Datum in diesem Zeitraum"),
        (r"(\d+) of (\d+) connections have too little history for odds(.*)\.",
         lambda m: f"{m[1]} von {m[2]} Verbindungen haben zu wenige vergangene Fahrten für eine Chance"
         + (" (keine Daten für FlixTrain-Abschnitte)" if m[3] else "") + "."),
        (r"Under 60 minutes late \((\d+) min\): no compensation is due\.",
         lambda m: f"Unter 60 Minuten verspätet ({m[1]} Min.): keine Entschädigung."),
        (r"(\d+) % of the ticket price is owed\. Enter the price to see the amount\.",
         lambda m: f"Du hast Anspruch auf {m[1]} % des Ticketpreises. Gib den Preis für den Betrag ein."),
        (r"(\d+) min late: (\d+) % of ([\d.]+) EUR, rounded up to 5 cents\.",
         lambda m: f"{m[1]} Min. verspätet: {m[2]} % von {money(m[3])}, auf 5 Cent aufgerundet."),
        (r"(\d+) % would be ([\d.]+) EUR; DB pays nothing under 4.00 EUR\. .*",
         lambda m: f"{m[1]} % wären {money(m[2])}; unter 4,00 € zahlt die DB nichts aus. "
         "Die aufgehobene Zugbindung ab 20 Minuten und die volle Erstattung bei "
         "Reiseverzicht ab erwarteten 60 Minuten gelten trotzdem."),
        (r"Replay of data recorded on (.*); observation times are playback times\.",
         lambda m: f"Wiedergabe aufgezeichneter Daten vom {m[1]}; Beobachtungszeiten sind Wiedergabezeiten."),
        (r"A strike is announced for this day;.*",
         lambda m: "Für diesen Tag ist ein Streik angekündigt. Vergangene Fahrten bilden Streiktage "
         "nicht ab, deshalb gibt Kurt keinen Tipp. Wähle einen anderen Reisetag."),
        (r"A strike was announced but its dates are unclear\..*",
         lambda m: "Ein Streik ist angekündigt, aber die Daten sind unklar. Fällt er auf diesen Tag, "
         "bilden vergangene Fahrten den Streik nicht ab."),
        (r"A strike is announced for (.*), not for this day\.",
         lambda m: f"Ein Streik ist für {m[1]} angekündigt, nicht für diesen Tag."),
        (r"Unknown station: (.*)", lambda m: f"Unbekannter Bahnhof: {m[1]}. Wähle einen Bahnhof aus der Liste"),
        (r"No history for (.*)", lambda m: f"Keine vergangenen Fahrten für {m[1]}"),
        (r"'(.*)' is not a train like 'ICE 1103'", lambda m: f"„{m[1]}“ ist keine Zugnummer wie „ICE 1103“"),
        (r"'(.*)' is not a stop (.*)", lambda m: f"„{m[1]}“ ist kein Halt {m[2].replace('of ', 'von ').replace('stops:', 'Halte:')}"),
        (r"The history covers (.*) to (.*), not (.*)",
         lambda m: f"Die Daten reichen von {m[1]} bis {m[2]}, nicht bis {m[3]}"),
    ]
    for pattern, render in patterns:
        match = re.fullmatch(pattern, value)
        if match:
            return render(match)
    return value


def localize(value, lang: str):
    if lang != "de":
        return value
    if isinstance(value, list):
        return [localize(item, lang) for item in value]
    if isinstance(value, dict):
        return {key: text(item, lang) if key in {"label", "note", "reason", "where", "source"}
                and isinstance(item, str) else localize(item, lang) for key, item in value.items()}
    return value
