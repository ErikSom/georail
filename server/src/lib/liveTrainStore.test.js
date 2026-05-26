import test from 'node:test';
import assert from 'node:assert/strict';
import {
    cellRangeFor,
    createLiveTrainStore,
    getCellKey,
    quantizeBBoxOutward,
} from './liveTrainStore.js';

function fakeTrain(overrides = {}) {
    return {
        id: 'ns:test1',
        source: 'ns',
        lon: 4.9041,
        lat: 52.3676,
        speedMs: 30,
        bearingDeg: 90,
        meta: { type: 'VIRM' },
        ...overrides,
    };
}

test('getCellKey handles exact boundaries and negative coordinates', () => {
    assert.equal(getCellKey(52.3, 4.9), '523_49');
    assert.equal(getCellKey(0, 0), '0_0');
    assert.equal(getCellKey(-0.01, -0.01), '-1_-1');
    assert.throws(() => getCellKey(Number.NaN, 4), /finite/);
    assert.throws(() => getCellKey(52, Number.POSITIVE_INFINITY), /finite/);
});

test('cellRangeFor covers negative coordinates and exact boundaries', () => {
    assert.deepEqual(cellRangeFor(4.99, 52.0, 5.01, 52.09), ['520_49', '520_50']);
    assert.deepEqual(cellRangeFor(-0.11, -0.11, 0.0, 0.0), ['-2_-2', '-2_-1', '-2_0', '-1_-2', '-1_-1', '-1_0', '0_-2', '0_-1', '0_0']);
    assert.throws(() => cellRangeFor(5, 52, 4, 53), /min values/);
});

test('upsert moves a train between cell buckets', () => {
    const store = createLiveTrainStore();
    store.upsert(fakeTrain({ lon: 4.99, lat: 52.0 }));
    const oldCell = store.getCellKey(52.0, 4.99);
    assert.equal(store.bucketIndex.get(oldCell)?.has('ns:test1'), true);

    store.upsert(fakeTrain({ lon: 5.01, lat: 52.0 }));
    const newCell = store.getCellKey(52.0, 5.01);
    assert.equal(store.bucketIndex.get(oldCell)?.has('ns:test1'), undefined);
    assert.equal(store.bucketIndex.get(newCell)?.has('ns:test1'), true);
});

test('queryBBox returns records inside the padded bbox only', () => {
    const store = createLiveTrainStore({ edgePadDeg: 0.02 });
    store.upsert(fakeTrain({ id: 'ns:a', lon: 4.90, lat: 52.10 }));
    store.upsert(fakeTrain({ id: 'ns:b', lon: 4.99, lat: 52.11 }));
    store.upsert(fakeTrain({ id: 'ns:c', lon: 5.019, lat: 52.11 }));
    store.upsert(fakeTrain({ id: 'ns:d', lon: 5.04, lat: 52.11 }));

    const ids = store.queryBBox(4.89, 52.09, 5.0, 52.12).map(r => r.id).sort();
    assert.deepEqual(ids, ['ns:a', 'ns:b', 'ns:c']);
});

test('trail is oldest-first and latest references the last array entry', () => {
    let now = 1_000;
    const store = createLiveTrainStore({ now: () => now, maxTrailPoints: 20 });
    for (let i = 0; i < 5; i++) {
        now += 1_000;
        store.upsert(fakeTrain({ lon: 4.9 + i * 0.001 }));
    }

    const record = store.getById('ns:test1');
    assert.ok(record);
    assert.equal(record.positions.length, 5);
    assert.ok(record.positions[0].ts < record.positions[4].ts);
    assert.equal(record.latest, record.positions[record.positions.length - 1]);
});

test('explicit stale snapshot updates lastSeenAt without rewriting trail timestamps', () => {
    let now = 1_000;
    const store = createLiveTrainStore({ now: () => now });
    store.upsert(fakeTrain({ ts: 5_000, lon: 4.9 }));

    now = 7_000;
    const result = store.upsert(fakeTrain({ ts: 4_000, lon: 5.2, meta: { type: 'late' } }));
    const record = store.getById('ns:test1');

    assert.equal(result.stale, true);
    assert.equal(result.changed, false);
    assert.equal(record.positions.length, 1);
    assert.equal(record.latest.ts, 5_000);
    assert.equal(record.latest.lon, 4.9);
    assert.equal(record.lastSeenAt, 7_000);
    assert.equal(record.meta.type, 'late');
});

test('prune removes stale records from maps and buckets', () => {
    let now = 0;
    const store = createLiveTrainStore({ now: () => now });
    store.upsert(fakeTrain({ id: 'ns:a' }));
    store.upsert(fakeTrain({ id: 'ns:b', lon: 5.1 }));

    now = 6 * 60 * 1000;
    assert.equal(store.prune(), 2);
    assert.equal(store.trains.size, 0);
    assert.equal(store.bucketIndex.size, 0);
});

test('quantizeBBoxOutward never shrinks the requested bbox', () => {
    const q = quantizeBBoxOutward(4.1234, 52.9876, 4.9876, 53.1234);
    assert.deepEqual(q, {
        lonMin: 4.123,
        latMin: 52.987,
        lonMax: 4.988,
        latMax: 53.124,
    });
});
