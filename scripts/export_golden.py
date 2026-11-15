"""Regenerate core parity fixtures offline from the pinned Python implementation."""
import asyncio
import argparse
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import types

import httpx
from datetime import datetime
from decimal import Decimal
from types import SimpleNamespace
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
REVISION = 'f33b3b0'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--odds', type=Path, default=ROOT / 'data/odds.sqlite')
    args = parser.parse_args()
    # Load only the pinned pure modules; never initialize application settings.
    package = types.ModuleType('golden_backend')
    package.__path__ = []
    sys.modules[package.__name__] = package
    config = types.ModuleType('golden_backend.config')
    config.REPO_ROOT = ROOT
    sys.modules[config.__name__] = config
    for name in ('matching', 'odds'):
        module = types.ModuleType(f'golden_backend.{name}')
        sys.modules[module.__name__] = module
        source = subprocess.check_output(['git', 'show', f'{REVISION}:backend/app/{name}.py'], cwd=ROOT, text=True)
        exec(compile(source, f'{REVISION}/{name}.py', 'exec'), module.__dict__)
    matching = sys.modules['golden_backend.matching']
    odds = sys.modules['golden_backend.odds']
    db = sqlite3.connect(args.odds.resolve().as_uri() + '?mode=ro', uri=True)
    cases = []

    def case(fn, inputs, expected, label=''):
        cases.append(dict(fn=fn, args=inputs, expected=expected, label=label))

    for value in ['ICE 785', 'FLX10', ' ic 02013 ', None]:
        case('parseTrain', [value], matching.parse_train(value))
    for value in ['Köln Hbf (DE)', 'Frankfurt(M) Flughafen Fernbf', 'Berlin Hbf (tief)', 'S+U Berlin Hbf']:
        case('stationKey', [value], matching.station_key(value))
    lookups = [
        ('ok', ['ICE', '785', 'München Hbf', 4]),
        ('thin', ['D', '10300', 'Berlin Hbf', 0]),
        ('unknown_train', ['ICE', '99999', 'München Hbf', 4]),
        ('stop_not_matched', ['ICE', '785', 'Atlantis', 4]),
        ('family fallback', ['IC', '785', 'München Hbf', 4]),
        ('alias', ['ECE', '150', 'Frankfurt', 4]),
        ('missing weekday', ['D', '10300', 'Berlin Hbf', 4]),
        ('multi-EVA aggregation', ['D', '10300', 'Berlin Hbf', 6]),
    ]
    for label, values in lookups:
        expected = matching.find_stats(db, *values)
        if label in ('ok', 'thin', 'unknown_train', 'stop_not_matched'):
            assert expected['status'] == label
        if label == 'family fallback':
            assert expected['type_fallback']
        if label == 'alias':
            assert expected['match'] == 'alias'
        case('findStats', values, expected, label)
    def leg(train='ICE 785', stop='München Hbf', dep='2027-03-26T08:00:00Z', arr='2027-03-26T12:00:00Z'):
        return dict(train=train, to=stop, dep=dep, arr=arr)
    direct = [leg()]
    two = [leg(stop='Würzburg Hbf', arr='2027-03-26T10:00:00Z'), leg(dep='2027-03-26T10:23:00Z')]
    three = [*two[:1], leg(stop='Nürnberg Hbf', dep='2027-03-26T10:23:00Z', arr='2027-03-26T11:00:00Z'), leg(dep='2027-03-26T11:07:00Z')]
    for label, legs in [('direct', direct), ('two legs', two), ('three legs', three), ('middle leg without history', [three[0], {**three[1], 'train': 'ICE 99999'}, three[2]]), ('no history', [leg(train='FLX10')]), ('DST', [leg(arr='2027-03-28T01:30:00Z')])]:
        case('connectionOdds', [legs], odds.connection_odds(db, legs), label)
    for train in ['ICE 785', 'IC 785', 'FLX10', 'FLX 12345']:
        case('legOdds', [train, 'München Hbf', '2027-03-26T12:00:00Z'], odds.leg_odds(db, train, 'München Hbf', '2027-03-26T12:00:00Z'))
    for spare in [3, 20, 75]:
        case('missOdds', [two, spare], odds.miss_odds(db, two, spare))
    case('missOdds', [[leg(train='FLX10')], 3], None)
    case('connectionOdds', [two, 0], odds.connection_odds(db, two, 0), 'unshrunk')
    for value in [0.03125, 0.09375, 0.00015]:
        case('round4', [value], round(value, 4), 'exact half tie')
    case('shrink', [1, 32, 0, 0], odds.shrink(1, 32, 0, 0))
    for iso in ['2027-03-28T00:30:00Z', '2027-03-28T01:30:00Z', '2027-03-28T22:30:00Z', '2027-10-31T01:30:00Z']:
        local = datetime.fromisoformat(iso).astimezone(ZoneInfo('Europe/Berlin'))
        for fn, expected in [('weekdayBerlin', local.weekday()), ('berlinDate', local.date().isoformat()), ('berlinLocal', local.strftime('%Y-%m-%dT%H:%M:%S'))]:
            case(fn, [iso], expected)
    for day, time in [('2027-03-28', '01:30'), ('2027-03-28', '02:30'), ('2027-03-28', '03:30'), ('2027-10-31', '02:30')]:
        dt = datetime.fromisoformat(f'{day}T{time}').replace(tzinfo=ZoneInfo('Europe/Berlin'))
        case('zonedToUtc', [day, time], dt.astimezone(ZoneInfo('UTC')).isoformat().replace('+00:00', '.000Z'))
    out = ROOT / 'frontend/tests/core/golden/odds.json'
    out.write_text(json.dumps(cases, ensure_ascii=False, indent=2) + '\n')
    for name, attrs in {
        'db': {'connect': None}, 'config': {'REPO_ROOT': ROOT, 'Settings': object},
        'signals': {'strike_signal': lambda *args: None},
    }.items():
        module = sys.modules.get(f'golden_backend.{name}') or types.ModuleType(f'golden_backend.{name}')
        module.__dict__.update(attrs)
        sys.modules[module.__name__] = module
    for name in ('transitous', 'stations', 'picks', 'claim'):
        module = types.ModuleType(f'golden_backend.{name}')
        sys.modules[module.__name__] = module
        source = subprocess.check_output(['git', 'show', f'{REVISION}:backend/app/{name}.py'], cwd=ROOT, text=True)
        exec(compile(source, f'{REVISION}/{name}.py', 'exec'), module.__dict__)
    picks = sys.modules['golden_backend.picks']
    claim = sys.modules['golden_backend.claim']
    plan = json.loads((ROOT / 'backend/tests/fixtures/plan_ham_muc.json').read_text())
    day = datetime.fromisoformat(plan['itineraries'][0]['legs'][0]['scheduledStartTime']).astimezone(odds.BERLIN).date()
    frozen_now = datetime.combine(day, datetime.min.time(), odds.BERLIN)
    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return frozen_now.astimezone(tz)
    picks.datetime = FrozenDateTime
    picks.odds_conn = lambda request: db
    class MockTransitous(sys.modules['golden_backend.transitous'].Transitous):
        async def plan(self, *args, **kwargs):
            return (await self._client.get('/api/v1/plan')).json()
    settings = SimpleNamespace(db_path=None, client_name='kurt-offline-fixtures')
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json=plan))
    tr = MockTransitous(settings, transport)
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(transitous=tr)))
    pick_cases = []
    async def generate_picks():
        try:
            for mode in ('depart', 'arrive'):
                query = dict(from_='de_test_ham', to='de_test_muc', day=day, at='14:00' if mode == 'arrive' else '06:00', mode=mode, before=0)
                expected = await picks.picks(request=request, **query)
                pick_cases.append(dict(query={'from': query['from_'], 'to': query['to'], 'date': day.isoformat(), 'time': query['at'], 'mode': mode}, expected=expected))
        finally:
            await tr.aclose()
    asyncio.run(generate_picks())
    claims = []
    for price, delay, switched in [
        (None, None, False), (None, 60, False), ('9.99', 59, False),
        ('9.99', 60, False), ('79.90', 60, False), ('79.90', 119, False),
        ('79.90', 120, False), ('34.99', 71, False), ('12.90', 65, False),
        ('79.90', 120, True),
    ]:
        claims.append(dict(args=[float(price) if price else None, delay, switched], expected=claim.compute_claim(Decimal(price) if price else None, delay, switched)))
    snaps = [dict(at=str(i), delay_min=d, cancelled=c) for i, (d, c) in enumerate([(None, False), (18, False), (20, False), (19, False), (22, False), (60, False), (61, True), (62, True)])]
    payload = dict(now=frozen_now.isoformat(), plan=plan, picks=pick_cases, claims=claims, timeline=dict(args=snaps, expected=claim.timeline(snaps)))
    (out.parent / 'picks.json').write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n')
    db.close()
    print(f'Wrote {len(cases)} odds, {len(pick_cases)} picks, {len(claims)} claim and 1 timeline cases from {REVISION}')


if __name__ == '__main__':
    main()
