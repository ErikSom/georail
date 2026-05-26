import test from 'node:test';
import assert from 'node:assert/strict';
import { createNsConsistStore, __private } from './nsConsistStore.js';

test('normalizeConsist extracts car count, length and material parts', () => {
    const consist = __private.normalizeConsist({
        bron: 'DVS',
        ritnummer: 6130,
        type: 'SNG',
        lengte: 7,
        lengteInMeters: 137,
        materieeldelen: [
            {
                materieelnummer: 2308,
                type: 'SNG 3',
                faciliteiten: ['FIETS', 'WIFI'],
                afbeelding: 'https://example.test/sng_3.png',
                breedte: 1241,
                hoogte: 126,
                bakken: [{}, {}, {}],
            },
            {
                materieelnummer: 2720,
                type: 'SNG 4',
                faciliteiten: ['TOILET'],
                afbeelding: 'https://example.test/sng_4.png',
                breedte: 1580,
                hoogte: 126,
                bakken: [{}, {}, {}, {}],
            },
        ],
    });

    assert.equal(consist.ritnummer, '6130');
    assert.equal(consist.type, 'SNG');
    assert.equal(consist.carCount, 7);
    assert.equal(consist.lengthM, 137);
    assert.equal(consist.parts.length, 2);
    assert.equal(consist.parts[0].carCount, 3);
    assert.equal(consist.parts[1].image, 'https://example.test/sng_4.png');
});

test('getMany batches ids and caches normalized consists', async () => {
    let calls = 0;
    const store = createNsConsistStore({
        now: () => 1_000,
        fetchRaw: async (ids) => {
            calls++;
            assert.deepEqual(ids, ['6130', '8618']);
            return [
                { ritnummer: 6130, bron: 'DAGPLAN', type: 'SNG', lengte: 3, materieeldelen: [{ type: 'SNG 3', bakken: [{}, {}, {}] }] },
                { ritnummer: 6130, bron: 'DVS', type: 'SNG', lengte: 4, lengteInMeters: 78, materieeldelen: [{ type: 'SNG 4', bakken: [{}, {}, {}, {}] }] },
            ];
        },
    });

    const first = await store.getMany(['ns:6130', '8618']);
    const second = await store.getMany(['6130']);

    assert.equal(calls, 1);
    assert.equal(first['6130'].carCount, 4);
    assert.equal(first['6130'].lengthM, 78);
    assert.equal(first['8618'], null);
    assert.equal(second['6130'].type, 'SNG');
});

test('getMany dedupes concurrent misses for the same train ids', async () => {
    let calls = 0;
    let release;
    const blocker = new Promise(resolve => {
        release = resolve;
    });
    const store = createNsConsistStore({
        now: () => 1_000,
        fetchRaw: async (ids) => {
            calls++;
            assert.deepEqual(ids, ['6130']);
            await blocker;
            return [
                { ritnummer: 6130, bron: 'DVS', type: 'SNG', lengte: 3, materieeldelen: [{ type: 'SNG 3', bakken: [{}, {}, {}] }] },
            ];
        },
    });

    const first = store.getMany(['6130']);
    const second = store.getMany(['ns:6130']);
    release();

    const [firstResult, secondResult] = await Promise.all([first, second]);

    assert.equal(calls, 1);
    assert.equal(firstResult['6130'].carCount, 3);
    assert.equal(secondResult['6130'].carCount, 3);
});

test('getMany prunes expired consist cache entries', async () => {
    let time = 1_000;
    let calls = 0;
    const store = createNsConsistStore({
        now: () => time,
        ttlMs: 100,
        maxCacheEntries: 2,
        fetchRaw: async (ids) => {
            calls++;
            return ids.map(id => ({
                ritnummer: id,
                bron: 'DVS',
                type: 'SNG',
                lengte: 3,
                materieeldelen: [{ type: 'SNG 3', bakken: [{}, {}, {}] }],
            }));
        },
    });

    await store.getMany(['1', '2']);
    assert.equal(store.cache.size, 2);

    time = 1_200;
    await store.getMany(['3']);

    assert.equal(calls, 2);
    assert.equal(store.cache.has('1'), false);
    assert.equal(store.cache.has('2'), false);
    assert.equal(store.cache.has('3'), true);
});
