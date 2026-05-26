import test from 'node:test';
import assert from 'node:assert/strict';
import { ChunkStore } from './chunkStore.ts';
import { snap, sampleSegmentBetweenFractions } from './snap.ts';
import type { RailChunk, RailSegment } from './api.ts';

function segment(id: number, source: number, target: number, geom: [number, number][]): RailSegment {
    // length in km-ish; close enough for the snap algorithm (only used as a
    // budget cap in the graph walk, doesn't need to be geodesic-accurate).
    let total = 0;
    for (let i = 0; i < geom.length - 1; i++) {
        const dx = (geom[i + 1][0] - geom[i][0]) * 71_000;   // m / deg lon ~ at NL latitudes
        const dy = (geom[i + 1][1] - geom[i][1]) * 111_320;
        total += Math.hypot(dx, dy);
    }
    return { id, source, target, lengthM: total, geom, worldOffsets: [] };
}

function chunk(segments: RailSegment[]): RailChunk {
    return {
        cell: { lon: 51, lat: 520 },
        bounds: { lonMin: 5.1, latMin: 52.0, lonMax: 5.2, latMax: 52.1 },
        country: 'NL',
        segments,
    };
}

async function makeStoreWith(segments: RailSegment[]): Promise<ChunkStore> {
    const store = new ChunkStore({
        fetch: async () => chunk(segments),
    });
    await store.ensureChunk({ lon: 51, lat: 520 });
    return store;
}

test('recovery: snaps an offset point to the closest line', async () => {
    // Two parallel east-west tracks ~14m apart at lat 52.0 and 52.0002.
    const trackA = segment(1, 100, 101, [[5.1, 52.0], [5.2, 52.0]]);
    const trackB = segment(2, 200, 201, [[5.1, 52.0002], [5.2, 52.0002]]);
    const store = await makeStoreWith([trackA, trackB]);

    const result = snap(
        { lon: 5.15, lat: 52.00018, ts: 1000, speedMs: 30, bearingDeg: 90 },
        undefined,
        store,
    );
    assert.ok(result);
    assert.equal(result!.segmentId, 2);
    assert.equal(result!.via, 'recovery');
    assert.ok(result!.snapDistanceM < 5, `expected snap distance < 5m, got ${result!.snapDistanceM}`);
});

test('happy path: with a confirmed prior on the correct track, stays there even with NS noise', async () => {
    // Same parallel tracks. NS reports a noisy position closer to B but the
    // prior says we're on A.
    const trackA = segment(1, 100, 101, [[5.1, 52.0], [5.2, 52.0]]);
    const trackB = segment(2, 200, 201, [[5.1, 52.0002], [5.2, 52.0002]]);
    const store = await makeStoreWith([trackA, trackB]);

    const result = snap(
        { lon: 5.15, lat: 52.000175, ts: 15000, speedMs: 30, bearingDeg: 90 },
        { segmentId: 1, fraction: 0.4, ts: 0 },
        store,
    );
    assert.ok(result);
    assert.equal(result!.segmentId, 1, `expected to stay on track 1, got ${result!.segmentId} via ${result!.via}`);
    assert.equal(result!.via, 'happy');
});

test('happy path: continuity lock beats a closer reachable parallel track', async () => {
    // Parallel tracks sharing endpoint ids mimic crossovers/station throats:
    // both are reachable, but continuity should keep us on the prior track.
    const trackA = segment(1, 100, 101, [[5.1, 52.0], [5.2, 52.0]]);
    const trackB = segment(2, 100, 101, [[5.1, 52.0002], [5.2, 52.0002]]);
    const store = await makeStoreWith([trackA, trackB]);

    const result = snap(
        { lon: 5.15, lat: 52.00018, ts: 15000, speedMs: 30, bearingDeg: 90 },
        { segmentId: 1, fraction: 0.4, ts: 0 },
        store,
    );
    assert.ok(result);
    assert.equal(result!.segmentId, 1);
    assert.equal(result!.via, 'happy');
});

test('happy path: reachable into a connected neighbour segment', async () => {
    // Two segments joined head-to-tail at node 100. Prior is on seg1, the
    // raw point is partway along seg2.
    const seg1 = segment(1, 99, 100, [[5.10, 52.0], [5.15, 52.0]]);
    const seg2 = segment(2, 100, 101, [[5.15, 52.0], [5.20, 52.0]]);
    const store = await makeStoreWith([seg1, seg2]);

    const result = snap(
        { lon: 5.17, lat: 52.0, ts: 15000, speedMs: 30, bearingDeg: 90 },
        { segmentId: 1, fraction: 0.9, ts: 0 },
        store,
    );
    assert.ok(result);
    assert.equal(result!.segmentId, 2);
    assert.equal(result!.via, 'happy');
});

test('happy path: slow train near a switch endpoint stays on its prior segment', async () => {
    const approach = segment(1, 99, 100, [[5.10, 52.0], [5.15, 52.0]]);
    const divergingSwitch = segment(2, 100, 101, [[5.15, 52.0], [5.17, 52.001]]);
    const store = await makeStoreWith([approach, divergingSwitch]);

    // Raw position is closer to the diverging switch than to the approach
    // segment, but at low speed near the shared endpoint we should keep the
    // committed approach track until movement clearly leaves it.
    const result = snap(
        { lon: 5.1503, lat: 52.0002, ts: 15_000, speedMs: 1, bearingDeg: 90 },
        { segmentId: 1, fraction: 0.98, ts: 0 },
        store,
    );

    assert.ok(result);
    assert.equal(result!.segmentId, 1);
    assert.equal(result!.via, 'happy');
});

test('happy path: moving train near a switch endpoint can leave the prior segment', async () => {
    const approach = segment(1, 99, 100, [[5.10, 52.0], [5.15, 52.0]]);
    const divergingSwitch = segment(2, 100, 101, [[5.15, 52.0], [5.17, 52.001]]);
    const store = await makeStoreWith([approach, divergingSwitch]);

    const result = snap(
        { lon: 5.160, lat: 52.0005, ts: 15_000, speedMs: 6, bearingDeg: 90 },
        { segmentId: 1, fraction: 0.98, ts: 0 },
        store,
    );

    assert.ok(result);
    assert.equal(result!.segmentId, 2);
    assert.equal(result!.via, 'happy');
});

test('returns null when no segment is within the recovery radius', async () => {
    const seg1 = segment(1, 100, 101, [[5.1, 52.0], [5.2, 52.0]]);
    const store = await makeStoreWith([seg1]);
    // 0.01° north = ~1.1 km, well past the 100m recovery cap.
    const result = snap({ lon: 5.15, lat: 52.01, ts: 1000 }, undefined, store);
    assert.equal(result, null);
});

test('sampleSegmentBetweenFractions: t=0.5 lands between the two fractional points', () => {
    const seg = segment(1, 0, 1, [[5, 52], [6, 52]]);
    const sample = sampleSegmentBetweenFractions(seg, 0.2, 0.6, 0.5);
    assert.ok(sample);
    // 0.2 + (0.6-0.2)*0.5 = 0.4 along the segment.
    assert.ok(Math.abs(sample!.lon - 5.4) < 0.001);
});
