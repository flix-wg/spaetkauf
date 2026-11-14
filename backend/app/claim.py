"""Compensation maths (claim-helper spec) and GET /api/trips/{id}/claim."""

from decimal import ROUND_CEILING, Decimal

STEP = Decimal("0.05")
MINIMUM = Decimal("4.00")
WHERE = (
    "File it yourself with DB: online at bahn.de (Fahrgastrechte), in the DB Navigator app "
    "or at a DB travel centre. This app never submits a claim."
)


def claim_pct(delay_min: int | None) -> int:
    if delay_min is None or delay_min < 60:
        return 0
    return 50 if delay_min >= 120 else 25


def claim_amount(price: Decimal, pct: int) -> Decimal:
    raw = price * pct / 100
    return (raw / STEP).to_integral_value(rounding=ROUND_CEILING) * STEP


def timeline(snaps: list[dict]) -> list[dict]:
    """First observation, each change of 5+ min against the last kept row, last observation."""
    rows = [s for s in snaps if s["delay_min"] is not None or s["cancelled"]]
    kept: list[dict] = []
    for i, s in enumerate(rows):
        prev = kept[-1] if kept else None
        if (
            prev is None
            or i == len(rows) - 1
            or bool(s["cancelled"]) != prev["cancelled"]
            or abs((s["delay_min"] or 0) - (prev["delay_min"] or 0)) >= 5
        ):
            kept.append(
                {"at": s["at"], "delay_min": s["delay_min"], "cancelled": bool(s["cancelled"])}
            )
    return kept


def compute_claim(price: Decimal | None, delay_min: int | None, switched: bool) -> dict:
    """Return {due, pct, amount_eur, reason}."""
    if switched:
        return {
            "due": False,
            "pct": 0,
            "amount_eur": None,
            "reason": (
                "You switched trains: compensation depends on your actual arrival on the train "
                "you took. If you arrived under 60 minutes late, nothing is owed; "
                "60–119 minutes gives 25 % of the ticket price, 120+ gives 50 % "
                "(minimum payout 4 EUR). Fill in your actual arrival yourself."
            ),
        }
    pct = claim_pct(delay_min)
    if delay_min is None:
        return {"due": False, "pct": 0, "amount_eur": None, "reason": "No delay recorded yet."}
    if pct == 0:
        return {
            "due": False, "pct": 0, "amount_eur": None,
            "reason": f"Under 60 minutes late ({delay_min} min): no compensation is due.",
        }
    if price is None:
        return {
            "due": True,
            "pct": pct,
            "amount_eur": None,
            "reason": f"{pct} % of the ticket price is owed. Enter the price to see the amount.",
        }
    amount = claim_amount(price, pct)
    if amount < MINIMUM:
        return {
            "due": False,
            "pct": pct,
            "amount_eur": None,
            "reason": (
                f"{pct} % would be {amount:.2f} EUR; DB pays nothing under 4.00 EUR. "
                "Still yours: the lifted Zugbindung from 20 minutes late, and a full refund "
                "if you give up the trip at an expected 60+ minutes."
            ),
        }
    return {
        "due": True,
        "pct": pct,
        "amount_eur": float(amount),
        "reason": f"{delay_min} min late: {pct} % of {price:.2f} EUR, rounded up to 5 cents.",
    }
