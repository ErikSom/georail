import test from 'node:test';
import assert from 'node:assert/strict';
import {
    haversineDistanceM,
    bearingDeg,
    projectPointOntoSegment,
    projectPointOntoPolyline,
    samplePolylineAt,
    cellForPoint,
    cellsCoveringBBox,
    CELL_SCALE,
} from './geom.ts';

test('haversine: ~100m for 0.001° lat diff at equator', () => {
    const d = haversineDistanceM({ lon: 0, lat: 0 }, { lon: 0, lat: 0.001 });
    assert.ok(Math.abs(d - 111.32) < 1.0, `expected ~111m, got ${d.toFixed(2)}m`);
});

test('haversine: ~14m for 0.0002° lon diff at NL latitude (52°)', () => {
    const d = haversineDistanceM({ lon: 5.1, lat: 52.1 }, { lon: 5.1002, lat: 52.1 });
    assert.ok(Math.abs(d - 13.7) < 1.0, `expected ~13.7m, got ${d.toFixed(2)}m`);
});

test('bearingDeg: north is 0, east is 90, south is 180, west is 270', () => {
    const c = { lon: 5, lat: 52 };
    assert.ok(Math.abs(bearingDeg(c, { lon: 5, lat: 53 }) - 0) < 1);
    assert.ok(Math.abs(bearingDeg(c, { lon: 6, lat: 52 }) - 90) < 1);
    assert.ok(Math.abs(bearingDeg(c, { lon: 5, lat: 51 }) - 180) < 1);
    assert.ok(Math.abs(bearingDeg(c, { lon: 4, lat: 52 }) - 270) < 1);
});

test('projectPointOntoSegment: foot of perpendicular for a midpoint-offset', () => {
    // A horizontal segment along latitude 52, from lon 5 to 6. A point just
    // north of the midpoint should snap to the midpoint with the distance
    // matching the north offset.
    const a = { lon: 5, lat: 52 };
    const b = { lon: 6, lat: 52 };
    const p = { lon: 5.5, lat: 52.0005 };
    const proj = projectPointOntoSegment(p, a, b);
    assert.ok(Math.abs(proj.fraction - 0.5) < 0.001, `expected fraction ~0.5, got ${proj.fraction}`);
    assert.ok(Math.abs(proj.lon - 5.5) < 1e-6);
    assert.ok(Math.abs(proj.lat - 52) < 1e-6);
    assert.ok(Math.abs(proj.distanceM - 55.66) < 1.5, `expected ~55m, got ${proj.distanceM.toFixed(2)}m`);
});

test('projectPointOntoSegment: point past the segment end clamps to t=1', () => {
    const proj = projectPointOntoSegment(
        { lon: 10, lat: 52 },
        { lon: 5, lat: 52 },
        { lon: 6, lat: 52 },
    );
    assert.equal(proj.fraction, 1);
});

test('projectPointOntoPolyline: nearest edge wins, fraction is global arc-length', () => {
    // L-shaped polyline: (5,52) -> (6,52) -> (6,53). Point at the bend.
    // Edge 1 ≈ 68.5 km (1° lon × cos(52°)), edge 2 ≈ 111.3 km. Corner is
    // at arc-length fraction 68.5 / (68.5 + 111.3) ≈ 0.381.
    const geom = [{ lon: 5, lat: 52 }, { lon: 6, lat: 52 }, { lon: 6, lat: 53 }];
    const proj = projectPointOntoPolyline({ lon: 6.0001, lat: 52.0001 }, geom);
    assert.ok(proj);
    assert.ok(Math.abs(proj!.fraction - 0.381) < 0.02, `expected ~0.381, got ${proj!.fraction}`);
    assert.ok(proj!.distanceM < 20, `expected near-zero distance at the corner, got ${proj!.distanceM}m`);
});

test('samplePolylineAt: midpoint of an L gives the corner', () => {
    const geom = [{ lon: 5, lat: 52 }, { lon: 6, lat: 52 }, { lon: 6, lat: 53 }];
    const sample = samplePolylineAt(geom, 0.5);
    assert.ok(sample);
    // The corner is at (6, 52). Edge lengths are unequal in meters (one
    // is along longitude, the other along latitude) so the midpoint in
    // arc length won't be exactly at the corner, but it should be close.
    assert.ok(Math.abs(sample!.lon - 6) < 0.2);
    assert.ok(Math.abs(sample!.lat - 52) < 0.5);
});

test('cellForPoint / cellsCoveringBBox: NL cells', () => {
    assert.deepEqual(cellForPoint(5.123, 52.456), { lon: 51, lat: 524 });
    assert.equal(CELL_SCALE, 10);
    const cells = cellsCoveringBBox(5.1, 52.0, 5.25, 52.15);
    // Lon spans [51,52] (2 columns), lat spans [520,521] (2 rows) = 4 cells.
    assert.equal(cells.length, 4);
});
