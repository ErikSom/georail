import test from 'node:test';
import assert from 'node:assert/strict';
import { ChunkStore } from './chunkStore.ts';
import { buildTrackRoute, progressWithEndpointSpeeds, sampleTrackRouteAtDistance, type TrackRoute } from './trackRoute.ts';
import type { RailSegment } from './api.ts';

function segment(id: number, source: number, target: number, geom: [number, number][]): RailSegment {
    let total = 0;
    for (let i = 0; i < geom.length - 1; i++) {
        const dx = (geom[i + 1][0] - geom[i][0]) * 68_600;
        const dy = (geom[i + 1][1] - geom[i][1]) * 111_320;
        total += Math.hypot(dx, dy);
    }
    return { id, source, target, lengthM: total, geom, worldOffsets: [] };
}

test('progressWithEndpointSpeeds: matching average speeds stays linear', () => {
    assert.equal(progressWithEndpointSpeeds(0, 10_000, 100, 10, 10), 0);
    assert.ok(Math.abs(progressWithEndpointSpeeds(0.25, 10_000, 100, 10, 10) - 0.25) < 1e-9);
    assert.ok(Math.abs(progressWithEndpointSpeeds(0.5, 10_000, 100, 10, 10) - 0.5) < 1e-9);
    assert.ok(Math.abs(progressWithEndpointSpeeds(0.75, 10_000, 100, 10, 10) - 0.75) < 1e-9);
    assert.equal(progressWithEndpointSpeeds(1, 10_000, 100, 10, 10), 1);
});

test('progressWithEndpointSpeeds: acceleration starts slower than linear', () => {
    const halfway = progressWithEndpointSpeeds(0.5, 10_000, 100, 0, 20);
    assert.ok(halfway < 0.5, `expected less than 0.5, got ${halfway}`);
    assert.ok(halfway > 0.2, `expected monotone useful progress, got ${halfway}`);
});

test('progressWithEndpointSpeeds: deceleration starts faster than linear', () => {
    const halfway = progressWithEndpointSpeeds(0.5, 10_000, 100, 20, 0);
    assert.ok(halfway > 0.5, `expected more than 0.5, got ${halfway}`);
    assert.ok(halfway < 0.8, `expected monotone useful progress, got ${halfway}`);
});

test('progressWithEndpointSpeeds: unrealistic speeds are clamped to monotone progress', () => {
    let previous = 0;
    for (let i = 0; i <= 20; i++) {
        const t = i / 20;
        const progress = progressWithEndpointSpeeds(t, 10_000, 100, 500, 500);
        assert.ok(progress >= previous - 1e-9, `progress reversed at ${t}: ${progress} < ${previous}`);
        assert.ok(progress >= 0 && progress <= 1);
        previous = progress;
    }
});

test('sampleTrackRouteAtDistance interpolates rail world offsets', () => {
    const route: TrackRoute = {
        points: [
            { lon: 5.0, lat: 52.0, worldOffset: [0, 10, 0] },
            { lon: 5.1, lat: 52.0, worldOffset: [0, 20, 0] },
        ],
        lengthM: 100,
        via: 'same-segment',
    };
    const sample = sampleTrackRouteAtDistance(route, 50);
    assert.ok(sample?.worldOffset);
    assert.ok(Math.abs(sample!.worldOffset![1] - 15) < 1e-9);
});

test('buildTrackRoute penalizes routes that initially run opposite the train bearing', async () => {
    const store = new ChunkStore({
        fetch: async () => ({
            cell: { lon: 50, lat: 520 },
            bounds: { lonMin: 5.0, latMin: 52.0, lonMax: 5.02, latMax: 52.01 },
            country: 'NL',
            segments: [
                segment(1, 100, 101, [[5.00, 52.000], [5.01, 52.000]]),
                segment(2, 200, 201, [[5.011, 52.001], [5.021, 52.001]]),
                { ...segment(3, 100, 200, [[5.00, 52.000], [5.011, 52.001]]), lengthM: 10 },
                { ...segment(4, 101, 200, [[5.01, 52.000], [5.011, 52.001]]), lengthM: 1000 },
            ],
        }),
    });
    await store.ensureChunk({ lon: 50, lat: 520 });

    const route = buildTrackRoute(
        { lon: 5.002, lat: 52.000, ts: 0, segmentId: 1, fraction: 0.2, speedMs: 20, bearing: 90 },
        { lon: 5.013, lat: 52.001, ts: 15_000, segmentId: 2, fraction: 0.2, speedMs: 40, bearing: 90 },
        store,
    );

    assert.ok(route);
    const firstStep = sampleTrackRouteAtDistance(route!, 25);
    assert.ok(firstStep);
    assert.ok(firstStep!.lon > 5.002, `expected route to begin eastward, got lon ${firstStep!.lon}`);
});

test('buildTrackRoute uses a direct transition instead of backtracking to a distant switch', async () => {
    const store = new ChunkStore({
        fetch: async () => ({
            cell: { lon: 50, lat: 520 },
            bounds: { lonMin: 5.0, latMin: 52.0, lonMax: 5.03, latMax: 52.01 },
            country: 'NL',
            segments: [
                segment(1, 100, 101, [[5.00, 52.0000], [5.02, 52.0000]]),
                segment(2, 200, 201, [[5.00, 52.0001], [5.02, 52.0001]]),
                segment(3, 101, 201, [[5.02, 52.0000], [5.02, 52.0001]]),
            ],
        }),
    });
    await store.ensureChunk({ lon: 50, lat: 520 });

    const route = buildTrackRoute(
        { lon: 5.01, lat: 52.0000, ts: 0, segmentId: 1, fraction: 0.5, speedMs: 10, bearing: 90 },
        { lon: 5.01, lat: 52.0001, ts: 15_000, segmentId: 2, fraction: 0.5, speedMs: 10, bearing: 90 },
        store,
    );

    assert.ok(route);
    assert.equal(route!.via, 'transition');
    assert.ok(route!.lengthM < 20, `expected short direct transition, got ${route!.lengthM}m`);
});
