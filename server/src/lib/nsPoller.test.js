import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveTrainStore } from './liveTrainStore.js';
import { createNsPoller, __private } from './nsPoller.js';

function silentLogger() {
    return {
        info() { },
        warn() { },
        error() { },
    };
}

function nsPayload(overrides = {}) {
    return [{
        ritId: 'abc',
        treinNummer: 123,
        lat: 52.3676,
        lng: 4.9041,
        snelheid: 36,
        richting: 90,
        type: 'VIRM',
        ...overrides,
    }];
}

test('poller skips overlapping polls', async () => {
    const store = createLiveTrainStore();
    let calls = 0;
    let release;
    const blocker = new Promise(resolve => { release = resolve; });
    const poller = createNsPoller({
        store,
        logger: silentLogger(),
        fetchVehicles: async () => {
            calls++;
            await blocker;
            return nsPayload();
        },
    });

    const first = poller.pollOnce();
    const second = await poller.pollOnce();
    assert.equal(second.skipped, true);
    assert.equal(calls, 1);
    release();
    await first;
    assert.equal(store.queryAll().length, 1);
});

test('poller backs off on upstream failure and resets after success', async () => {
    const store = createLiveTrainStore();
    let fail = true;
    const poller = createNsPoller({
        store,
        logger: silentLogger(),
        fetchVehicles: async () => {
            if (fail) throw new Error('boom');
            return nsPayload();
        },
    });

    const failed = await poller.pollOnce();
    assert.equal(failed.ok, false);
    assert.equal(poller.status().currentBackoffMs, 5_000);

    fail = false;
    const ok = await poller.pollOnce();
    assert.equal(ok.ok, true);
    assert.equal(poller.status().currentBackoffMs, 0);
});

test('poller stores raw NS positions into the store', async () => {
    const store = createLiveTrainStore();
    const poller = createNsPoller({
        store,
        logger: silentLogger(),
        fetchVehicles: async () => nsPayload(),
    });

    await poller.pollOnce();
    const record = store.getById('ns:abc');
    assert.ok(record);
    assert.equal(record.source, 'ns');
    assert.equal(record.latest.lon, 4.9041);
    assert.equal(record.latest.lat, 52.3676);
    assert.equal(record.latest.bearingDeg, 90);
    assert.equal(record.latest.speedMs, 36 / 3.6);
    assert.equal(record.meta.treinNummer, 123);
});

test('poller keeps stationary NS trains', async () => {
    const store = createLiveTrainStore();
    const poller = createNsPoller({
        store,
        logger: silentLogger(),
        fetchVehicles: async () => nsPayload({ snelheid: 0 }),
    });

    const result = await poller.pollOnce();
    const record = store.getById('ns:abc');

    assert.equal(result.total, 1);
    assert.ok(record);
    assert.equal(store.queryAll().length, 1);
    assert.equal(record.latest.speedMs, 0);
});

test('normalizeNsTrain drops payloads missing rit id or coordinates', () => {
    assert.equal(__private.normalizeNsTrain({ lat: 52, lng: 4, ritId: 'x' }, 1)?.id, 'ns:x');
    assert.equal(__private.normalizeNsTrain({ lat: 52, lng: 4 }, 1), null);
    assert.equal(__private.normalizeNsTrain({ ritId: 'x', lat: 'oops', lng: 4 }, 1), null);
});
