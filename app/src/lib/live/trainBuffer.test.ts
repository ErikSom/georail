import test from 'node:test';
import assert from 'node:assert/strict';
import { ChunkStore } from './chunkStore.ts';
import { TrainTracker } from './trainBuffer.ts';
import type { RailChunk, RailSegment } from './api.ts';

function segment(id: number, source: number, target: number, geom: [number, number][]): RailSegment {
    let total = 0;
    for (let i = 0; i < geom.length - 1; i++) {
        const dx = (geom[i + 1][0] - geom[i][0]) * 68_600;
        const dy = (geom[i + 1][1] - geom[i][1]) * 111_320;
        total += Math.hypot(dx, dy);
    }
    return { id, source, target, lengthM: total, geom, worldOffsets: [] };
}

function chunkWithOneTrack(): RailChunk {
    return {
        cell: { lon: 51, lat: 520 },
        bounds: { lonMin: 5.1, latMin: 52.0, lonMax: 5.2, latMax: 52.1 },
        country: 'NL',
        segments: [
            {
                id: 1,
                source: 100,
                target: 101,
                lengthM: 6800,         // 0.1° lon ~= 6.8km at NL latitudes
                geom: [[5.1, 52.0], [5.2, 52.0]],
                worldOffsets: [],
            },
        ],
    };
}

async function makeTracker(): Promise<TrainTracker> {
    const store = new ChunkStore({ fetch: async () => chunkWithOneTrack() });
    await store.ensureChunk({ lon: 51, lat: 520 });
    return new TrainTracker(store);
}

async function makeTrackerWithSegments(segments: RailSegment[]): Promise<TrainTracker> {
    const store = new ChunkStore({
        fetch: async () => ({
            cell: { lon: 51, lat: 520 },
            bounds: { lonMin: 5.1, latMin: 52.0, lonMax: 5.2, latMax: 52.1 },
            country: 'NL',
            segments,
        }),
    });
    await store.ensureChunk({ lon: 51, lat: 520 });
    return new TrainTracker(store);
}

test('ingest snaps and stacks frames; interpolateAt linearly bridges them', async () => {
    const tracker = await makeTracker();
    tracker.ingest('ns:x', { lon: 5.10, lat: 52.0, ts: 0, speedMs: 30, bearingDeg: 90 });
    tracker.ingest('ns:x', { lon: 5.15, lat: 52.0, ts: 15_000, speedMs: 30, bearingDeg: 90 });
    const frames = tracker.framesFor('ns:x');
    assert.equal(frames.length, 2);
    assert.equal(frames[0].segmentId, 1);
    assert.equal(frames[1].segmentId, 1);

    // Halfway between ts=0 and ts=15000 → halfway between lon 5.10 and 5.15.
    const mid = tracker.interpolateAt('ns:x', 7_500);
    assert.ok(mid);
    assert.equal(mid!.status, 'playing');
    assert.ok(Math.abs(mid!.lon - 5.125) < 0.001, `expected ~5.125, got ${mid!.lon}`);
});

test('ingest rejects stale (ts <= previousTs) and duplicate raw positions', async () => {
    const tracker = await makeTracker();
    assert.ok(tracker.ingest('ns:x', { lon: 5.1, lat: 52, ts: 100 }));
    assert.equal(tracker.ingest('ns:x', { lon: 5.1, lat: 52, ts: 100 }), null);
    assert.equal(tracker.ingest('ns:x', { lon: 5.1, lat: 52, ts: 50 }), null);
});

test('ingest skips repeated moving positions so stale NS points do not create stop-go motion', async () => {
    const tracker = await makeTracker();
    assert.ok(tracker.ingest('ns:x', { lon: 5.10, lat: 52, ts: 0, speedMs: 30, bearingDeg: 90 }));
    assert.equal(tracker.ingest('ns:x', { lon: 5.10, lat: 52, ts: 15_000, speedMs: 30, bearingDeg: 90 }), null);
    assert.equal(tracker.ingest('ns:x', { lon: 5.10, lat: 52, ts: 30_000, speedMs: 30, bearingDeg: 90 }), null);
    assert.ok(tracker.ingest('ns:x', { lon: 5.13, lat: 52, ts: 45_000, speedMs: 30, bearingDeg: 90 }));

    const frames = tracker.framesFor('ns:x');
    assert.equal(frames.length, 2);
    assert.equal(frames[0].ts, 0);
    assert.equal(frames[1].ts, 45_000);

    const mid = tracker.interpolateAt('ns:x', 22_500);
    assert.equal(mid!.status, 'playing');
    assert.ok(mid!.lon > 5.10 && mid!.lon < 5.13, `expected smoothed movement across stale gap, got ${mid!.lon}`);
});

test('ingest keeps repeated stopped positions so station stops remain stops', async () => {
    const tracker = await makeTracker();
    assert.ok(tracker.ingest('ns:x', { lon: 5.10, lat: 52, ts: 0, speedMs: 0, bearingDeg: 90 }));
    assert.ok(tracker.ingest('ns:x', { lon: 5.10, lat: 52, ts: 15_000, speedMs: 0, bearingDeg: 90 }));
    assert.equal(tracker.framesFor('ns:x').length, 2);
});

test('ingest holds small stopped-position jitter at stations', async () => {
    const tracker = await makeTracker();
    assert.ok(tracker.ingest('ns:x', { lon: 5.10, lat: 52, ts: 0, speedMs: 0, bearingDeg: 90 }));
    assert.ok(tracker.ingest('ns:x', { lon: 5.1003, lat: 52, ts: 15_000, speedMs: 0, bearingDeg: 90 }));

    const frames = tracker.framesFor('ns:x');
    assert.equal(frames.length, 2);
    assert.equal(frames[1].ts, 15_000);
    assert.ok(Math.abs(frames[1].lon - frames[0].lon) < 1e-9, `expected stopped train to hold, got ${frames[1].lon}`);
});

test('ingest rejects moving frames opposite the reported movement bearing', async () => {
    const tracker = await makeTracker();
    assert.ok(tracker.ingest('ns:x', { lon: 5.15, lat: 52, ts: 0, speedMs: 30, bearingDeg: 90 }));
    assert.equal(tracker.ingest('ns:x', { lon: 5.14, lat: 52, ts: 15_000, speedMs: 30, bearingDeg: 90 }), null);
    assert.equal(tracker.framesFor('ns:x').length, 1);
});

test('ingest accepts true reversals when reported bearing agrees', async () => {
    const tracker = await makeTracker();
    assert.ok(tracker.ingest('ns:x', { lon: 5.15, lat: 52, ts: 0, speedMs: 30, bearingDeg: 90 }));
    assert.ok(tracker.ingest('ns:x', { lon: 5.14, lat: 52, ts: 15_000, speedMs: 30, bearingDeg: 270 }));
    assert.equal(tracker.framesFor('ns:x').length, 2);
});

test('ingest accepts short moving track transitions instead of standing still', async () => {
    const tracker = await makeTrackerWithSegments([
        segment(1, 100, 101, [[5.10, 52.000], [5.20, 52.000]]),
        segment(2, 100, 101, [[5.10, 52.001], [5.20, 52.001]]),
    ]);

    assert.ok(tracker.ingest('ns:x', { lon: 5.15, lat: 52.000, ts: 0, speedMs: 12, bearingDeg: 90 }));
    const accepted = tracker.ingest('ns:x', { lon: 5.15, lat: 52.001, ts: 15_000, speedMs: 12, bearingDeg: 90 });
    assert.ok(accepted);
    assert.equal(accepted!.segmentId, 2);
});

test('samplesAtOffsets renders a stationary train from one snapshot', async () => {
    const tracker = await makeTracker();
    tracker.ingest('ns:x', { lon: 5.15, lat: 52, ts: 0, speedMs: 0, bearingDeg: 90 });

    const samples = tracker.samplesAtOffsets('ns:x', 60_000, [0, 25, 50]);
    assert.ok(samples);
    assert.equal(samples!.length, 3);
    assert.ok(samples![1].lon < samples![0].lon, `stationary car 1 should sit behind head`);
    assert.ok(samples![2].lon < samples![1].lon, `stationary car 2 should sit behind car 1`);
});

test('samplesAtOffsets keeps a stopped train visible across identical station snapshots', async () => {
    const tracker = await makeTracker();
    tracker.ingest('ns:x', { lon: 5.15, lat: 52, ts: 0, speedMs: 0, bearingDeg: 90 });
    tracker.ingest('ns:x', { lon: 5.15, lat: 52, ts: 15_000, speedMs: 0, bearingDeg: 90 });
    tracker.ingest('ns:x', { lon: 5.15, lat: 52, ts: 30_000, speedMs: 0, bearingDeg: 90 });

    const samples = tracker.samplesAtOffsets('ns:x', 22_500, [0, 25, 50]);
    assert.ok(samples);
    assert.equal(samples!.length, 3);
    assert.ok(samples![1].lon < samples![0].lon, `stopped car 1 should sit behind head`);
    assert.ok(samples![2].lon < samples![1].lon, `stopped car 2 should sit behind car 1`);
});

test('ingest retries the same raw sample after rail chunks become available', async () => {
    const store = new ChunkStore({ fetch: async () => chunkWithOneTrack() });
    const tracker = new TrainTracker(store);

    assert.equal(tracker.ingest('ns:x', { lon: 5.1, lat: 52, ts: 100 }), null);
    await store.ensureChunk({ lon: 51, lat: 520 });

    const frame = tracker.ingest('ns:x', { lon: 5.1, lat: 52, ts: 100 });
    assert.ok(frame);
    assert.equal(tracker.framesFor('ns:x').length, 1);
});

test('interpolateAt: before first frame → buffering, after last → live edge', async () => {
    const tracker = await makeTracker();
    tracker.ingest('ns:x', { lon: 5.10, lat: 52, ts: 1000 });
    tracker.ingest('ns:x', { lon: 5.15, lat: 52, ts: 2000 });
    assert.equal(tracker.interpolateAt('ns:x', 0)!.status, 'buffering');
    assert.equal(tracker.interpolateAt('ns:x', 5000)!.status, 'live edge');
});

test('interpolateAt: single snapshot returns that point with status', async () => {
    const tracker = await makeTracker();
    tracker.ingest('ns:x', { lon: 5.10, lat: 52, ts: 1000 });
    const at = tracker.interpolateAt('ns:x', 1500);
    assert.equal(at!.status, 'single snapshot');
});

test('interpolateAt follows connected rail segments instead of chord-interpolating across land', async () => {
    const tracker = await makeTrackerWithSegments([
        segment(1, 100, 101, [[5.10, 52.00], [5.11, 52.00]]),
        segment(2, 101, 102, [[5.11, 52.00], [5.11, 52.01]]),
    ]);

    tracker.ingest('ns:x', { lon: 5.105, lat: 52.000, ts: 0, speedMs: 30, bearingDeg: 90 });
    tracker.ingest('ns:x', { lon: 5.110, lat: 52.005, ts: 15_000, speedMs: 30, bearingDeg: 0 });

    const mid = tracker.interpolateAt('ns:x', 7_500);
    assert.equal(mid!.status, 'playing');
    assert.ok(Math.abs(mid!.lon - 5.11) < 0.0002, `expected route to be on north/south segment, got ${mid!.lon}`);
    assert.ok(mid!.lat >= 52.0 && mid!.lat <= 52.005);

    const lines = tracker.trailLineCoordinatesFor('ns:x');
    assert.equal(lines.length, 1);
    assert.ok(lines[0].length > 2);
});

test('samplesAtOffsets places cars fixed meters behind the cab on the rail route', async () => {
    const tracker = await makeTracker();
    tracker.ingest('ns:x', { lon: 5.10, lat: 52, ts: 0, speedMs: 30, bearingDeg: 90 });
    tracker.ingest('ns:x', { lon: 5.16, lat: 52, ts: 15_000, speedMs: 30, bearingDeg: 90 });

    const samples = tracker.samplesAtOffsets('ns:x', 7_500, [0, 25, 50]);
    assert.ok(samples);
    assert.equal(samples!.length, 3);
    assert.ok(samples![1].lon < samples![0].lon, `car 1 should be behind head: ${samples![1].lon} >= ${samples![0].lon}`);
    assert.ok(samples![2].lon < samples![1].lon, `car 2 should be behind car 1: ${samples![2].lon} >= ${samples![1].lon}`);
});

test('samplesAtOffsets keeps cars across snapshot pair boundaries', async () => {
    const tracker = await makeTracker();
    tracker.ingest('ns:x', { lon: 5.10, lat: 52, ts: 0, speedMs: 30, bearingDeg: 90 });
    tracker.ingest('ns:x', { lon: 5.13, lat: 52, ts: 15_000, speedMs: 30, bearingDeg: 90 });
    tracker.ingest('ns:x', { lon: 5.16, lat: 52, ts: 30_000, speedMs: 30, bearingDeg: 90 });

    const samples = tracker.samplesAtOffsets('ns:x', 15_500, [0, 25, 50]);
    assert.ok(samples);
    assert.equal(samples!.length, 3);
    assert.ok(samples![1].lon < samples![0].lon, `car 1 should remain behind head across pair boundary`);
    assert.ok(samples![2].lon < samples![1].lon, `car 2 should remain behind car 1 across pair boundary`);
});

test('samplesAtOffsets refuses cars before enough track exists behind the head', async () => {
    const tracker = await makeTracker();
    tracker.ingest('ns:x', { lon: 5.10, lat: 52, ts: 0, speedMs: 30, bearingDeg: 90 });
    tracker.ingest('ns:x', { lon: 5.16, lat: 52, ts: 15_000, speedMs: 30, bearingDeg: 90 });

    assert.equal(tracker.samplesAtOffsets('ns:x', 100, [0, 25, 50]), null);
});

test('interpolateAt never draws a chord when no rail path is loaded between snapshots', async () => {
    const tracker = await makeTrackerWithSegments([
        segment(1, 100, 101, [[5.10, 52.00], [5.11, 52.00]]),
        segment(2, 200, 201, [[5.11, 52.00], [5.11, 52.01]]),
    ]);

    tracker.ingest('ns:x', { lon: 5.105, lat: 52.000, ts: 0, speedMs: 30, bearingDeg: 90 });
    tracker.ingest('ns:x', { lon: 5.110, lat: 52.005, ts: 15_000, speedMs: 30, bearingDeg: 0 });

    const mid = tracker.interpolateAt('ns:x', 7_500);
    assert.equal(mid!.status, 'loading path');
    assert.ok(
        (Math.abs(mid!.lon - 5.105) < 0.0002 && Math.abs(mid!.lat - 52.0) < 0.0002) ||
        (Math.abs(mid!.lon - 5.11) < 0.0002 && Math.abs(mid!.lat - 52.005) < 0.0002),
        `expected endpoint fallback, got ${mid!.lon},${mid!.lat}`,
    );
    assert.equal(tracker.trailLineCoordinatesFor('ns:x').length, 0);
});

test('dropMissing removes trains not in the active set', async () => {
    const tracker = await makeTracker();
    tracker.ingest('ns:a', { lon: 5.10, lat: 52, ts: 1000 });
    tracker.ingest('ns:b', { lon: 5.11, lat: 52, ts: 1000 });
    assert.equal(tracker.dropMissing(new Set(['ns:a'])), 1);
    assert.equal(Array.from(tracker.allIds()).length, 1);
});
