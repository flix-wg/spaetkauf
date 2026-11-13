from fastapi import APIRouter, Request

router = APIRouter(prefix="/api")
RAIL = {"HIGHSPEED_RAIL", "LONG_DISTANCE", "NIGHT_RAIL", "REGIONAL_RAIL"}


def rail_stops(results: list[dict]) -> list[dict]:
    return [
        {"id": r["id"], "name": r["name"], "lat": r["lat"], "lon": r["lon"]}
        for r in results
        if r.get("type") == "STOP" and RAIL & set(r.get("modes") or [])
    ]


@router.get("/stations")
async def stations(q: str, request: Request):
    if len(q.strip()) < 2:
        return []
    return rail_stops(await request.app.state.transitous.geocode(q.strip()))
