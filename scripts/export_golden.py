"""Regenerate core parity fixtures offline from the pinned Python implementation."""
import argparse
import asyncio
from datetime import datetime, timedelta
from decimal import Decimal
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import types
from zoneinfo import ZoneInfo

import httpx

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
    template = plan['itineraries'][0]
    plan['itineraries'] = []
    for name, departure, arrival, status in [
        ('ICE 785', '04:30', '11:21', ''),
        ('ICE 599', '05:15', '11:15', ''),
        ('ICE 703', '05:30', '12:00', 'posted'),
        ('ICE 703', '05:45', '12:15', 'cancelled'),
        ('TGV 123', '06:00', '11:00', ''),
        ('FLX 123', '06:15', '12:30', ''),
        ('ICE 785', '06:30', '13:45', ''),
        ('ICE 703', '06:45', '13:55', ''),
    ]:
        dep = datetime.fromisoformat(f'{day}T{departure}').replace(tzinfo=odds.BERLIN)
        arr = datetime.fromisoformat(f'{day}T{arrival}').replace(tzinfo=odds.BERLIN)
        delta = dep - datetime.fromisoformat(template['startTime'])
        def shift(value):
            if isinstance(value, dict):
                return {key: shift(item) for key, item in value.items()}
            if isinstance(value, list):
                return [shift(item) for item in value]
            if isinstance(value, str) and value.startswith(f'{day}T'):
                return picks._iso(datetime.fromisoformat(value) + delta)
            return value
        itinerary = shift(template)
        itinerary['startTime'], itinerary['endTime'] = picks._iso(dep), picks._iso(arr)
        leg = itinerary['legs'][0]
        leg['tripId'] = f'golden-{len(plan["itineraries"])}'
        leg['routeShortName'] = name
        leg['scheduledEndTime'] = picks._iso(arr)
        leg['to']['scheduledArrival'] = leg['to']['arrival'] = picks._iso(arr)
        leg['cancelled'] = status == 'cancelled'
        leg['realTime'] = status == 'posted'
        if leg['realTime']:
            leg['to']['arrival'] = picks._iso(arr + timedelta(minutes=25))
        leg = {key: leg[key] for key in (
            'tripId', 'routeShortName', 'scheduledStartTime', 'scheduledEndTime',
            'from', 'to', 'cancelled', 'realTime', 'intermediateStops',
        )}
        leg['from'] = {'name': leg['from']['name']}
        leg['to'] = {key: leg['to'][key] for key in ('name', 'arrival', 'scheduledArrival')}
        leg['intermediateStops'] = [{'name': stop['name']} for stop in leg['intermediateStops']]
        plan['itineraries'].append({'startTime': itinerary['startTime'], 'legs': [leg]})
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
    settings = types.SimpleNamespace(db_path=None, client_name='kurt-offline-fixtures')
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json=plan))
    tr = MockTransitous(settings, transport)
    request = types.SimpleNamespace(app=types.SimpleNamespace(state=types.SimpleNamespace(transitous=tr)))
    pick_cases = []
    async def generate_picks():
        try:
            for mode in ('depart', 'arrive'):
                query = dict(from_='de_test_ham', to='de_test_muc', day=day, at='14:00' if mode == 'arrive' else '05:00', mode=mode, before=60)
                expected = await picks.picks(request=request, **query)
                ranked = expected['picks']
                assert len(ranked) == (8 if mode == 'arrive' else 7)
                assert expected['note'] == f'2 of {len(ranked)} connections have too little history for odds.'
                assert expected['kurt_call'] == 'pick'
                assert [p['legs'][0]['train'] for p in ranked if p['is_kurts_pick']] == ['ICE 599']
                assert any(p['cancelled'] for p in ranked)
                assert any(p['already_posted'] and not p['cancelled'] for p in ranked)
                assert all(not p['is_kurts_pick'] for p in ranked if p['already_posted'])
                assert all('TGV 123' not in p['ride_instead']['trains'] for p in ranked if p['ride_instead'])
                if mode == 'depart':
                    assert ranked[0]['odds']['p20'] > ranked[1]['odds']['p20']
                    assert ranked[0]['ride_instead']['dep'] < ranked[0]['dep']
                    assert ranked[0]['ride_instead']['dep'] < picks._iso(picks.start_time(day, query['at'], frozen_now))
                    without_before = await picks.picks(request=request, **(query | {'before': 0}))
                    assert without_before['picks'][0]['ride_instead'] is None
                else:
                    groups = [p['group'] for p in ranked]
                    assert groups == ['late_ok'] * 6 + ['on_time'] * 2
                    assert ranked[0]['p_miss'] <= picks.P_MISS_CAP
                    assert ranked[-2]['arr'] > ranked[-1]['arr']
                pick_cases.append(dict(query={'from': query['from_'], 'to': query['to'], 'date': day.isoformat(), 'time': query['at'], 'mode': mode, 'before': query['before']}, expected=expected))
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
    ext_cases = extension_cases(db)
    db.close()
    print(f'Wrote {len(cases)} odds, {len(pick_cases)} picks, {len(claims)} claim, 1 timeline and {len(ext_cases)} extension cases from {REVISION}')


def extension_cases(db):
    """POST /api/ext/odds on the shapes of backend/tests/test_ext.py, with a fake Transitous."""
    module = types.ModuleType('golden_backend.ext')
    sys.modules[module.__name__] = module
    source = subprocess.check_output(['git', 'show', f'{REVISION}:backend/app/ext.py'], cwd=ROOT, text=True)
    exec(compile(source, f'{REVISION}/ext.py', 'exec'), module.__dict__)
    unavailable = sys.modules['golden_backend.transitous'].SourceUnavailable
    def stop(id, name):
        return dict(type='STOP', id=id, name=name, lat=0, lon=0, modes=['HIGHSPEED_RAIL'])
    geocode = {'Hamburg Hbf': [stop('de_ham', 'Hamburg Hbf')], 'München Hbf': [stop('de_muc', 'München Hbf')]}
    def leg(trip, train, origin, destination, dep, arr):
        return dict(tripId=trip, routeShortName=train, from_={'name': origin}, to={'name': destination},
                    scheduledStartTime=f'2026-11-20T{dep}:00Z', scheduledEndTime=f'2026-11-20T{arr}:00Z')
    plan = {'itineraries': [
        {'startTime': '2026-11-20T05:00:00Z', 'legs': [
            leg('a', 'ICE 591', 'Hamburg Hbf', 'Fulda', '05:00', '08:00'),
            leg('b', 'ICE 599', 'Fulda', 'Hauptbahnhof', '08:12', '11:00')]},
        {'startTime': '2026-11-20T05:30:00Z', 'legs': [leg('c', 'ICE 599', 'Hamburg Hbf', 'München Hbf', '05:30', '11:30')]},
    ]}
    plan = json.loads(json.dumps(plan).replace('"from_"', '"from"'))

    class Route:
        async def geocode(self, text):
            return geocode.get(text, [])
        async def plan(self, *args, **kwargs):
            return plan

    class Down:
        async def geocode(self, text):
            raise unavailable('down')

    def journey(dep, arr, *trains, **extra):
        return dict(dep=dep, arr=arr, trains=list(trains), **extra)
    route = {'from': 'Hamburg Hbf', 'to': 'München Hbf', 'date': '2026-11-20'}
    bodies = [
        ('route', route | {'connections': [
            journey('06:00', '12:00', 'ICE 591', 'ICE 599'), journey('06:30', '12:30', 'ICE0599'),
            journey('07:00', '13:00', 'RE 4', 'ICE 785'), journey('07:10', '13:30', 'ICE 785', 'RE 4'),
            journey('06:40', '12:10', 'RB 2'), journey('07:30', '13:40', 'ICE 99999'),
            journey('08:00', '12:20', 'ICE 1015', posted=True)]}),
        ('none', {'to': 'Unmatched destination', 'to_eva': '08000261', 'date': '2026-11-20', 'connections': [
            journey('23:00', '01:00', 'ICE 785'), journey('10:00', '14:00', 'ICE 785', date='2026-11-21'),
            journey('10:30', '14:10', 'RB 2', date='2026-11-21')]}),
        ('down', route | {'connections': [journey('06:00', '12:00', 'ICE 591', 'ICE 599'), journey('06:40', '12:10', 'RB 2')]}),
    ]
    out = []
    async def run():
        for transitous, body in bodies:
            tr = {'route': Route(), 'down': Down(), 'none': None}[transitous]
            request = types.SimpleNamespace(app=types.SimpleNamespace(state=types.SimpleNamespace(transitous=tr)))
            expected = await module.extension_odds(module.OddsRequest.model_validate(body), request)
            out.append(dict(transitous=transitous, body=body, expected=expected))
    asyncio.run(run())
    route_case, eva_case, down_case = (c['expected'] for c in out)
    assert [r['basis'] for r in route_case['results']] == ['estimate', 'history', 'last_train', 'none', 'none', 'none', 'history']
    assert route_case['kurt'] is not None and not route_case['results'][6]['kurt']
    assert eva_case['results'][0]['weekday'] == 'Saturday' and eva_case['results'][0]['p20'] is not None
    assert down_case['results'][0]['basis'] == 'last_train'
    payload = dict(geocode=geocode, plan=plan, cases=out)
    (ROOT / 'extension/test/golden.json').write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n')
    return out


if __name__ == '__main__':
    main()
