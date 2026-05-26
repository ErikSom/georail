// Client-side port of the reachability-first snap algorithm. Same
// two-path design as the SQL function we just deleted:
//
//   1) HAPPY PATH: walk the rail graph from the previous segment's
//      endpoints, snap to the closest reachable segment within 75 m.
//   2) RECOVERY: brute-force nearest-segment search over loaded
//      segments within 100 m, with a direction tiebreak.
//
// The graph walk is bounded to ~4 hops and a speed-derived distance
// budget. With loaded segments capped to the chunks the user is looking
// at (~600 per chunk × a handful of chunks), even the recovery path
// stays well under a millisecond.

import type { ChunkStore } from './chunkStore.ts';
import type { RailSegment } from './api.ts';
import {
    projectPointOntoPolyline,
    samplePolylineAt,
    type LonLat,
    type PolylineProjection,
} from './geom.ts';

export interface SnapInput extends LonLat {
    ts: number;
    speedMs?: number;
    bearingDeg?: number;
}

export interface SnapPrior {
    segmentId: number;
    fraction: number;
    ts: number;
}

export interface SnapResult {
    segmentId: number;
    fraction: number;
    lon: number;
    lat: number;
    bearing: number;
    snapDistanceM: number;
    via: 'happy' | 'recovery';
}

const HAPPY_DIST_LIMIT_M = 75;
const RECOVERY_DIST_LIMIT_M = 100;
const RECOVERY_RADIUS_DEG = 0.0025;             // ~280 m at NL latitudes
const PRIOR_SEGMENT_LOCK_M = 75;
const PRIOR_EDGE_LOCK_M = 25;
const SLOW_SWITCH_LOCK_SPEED_MS = 1.5;           // near-stopped; moving trains should advance through switches
const SLOW_SWITCH_EDGE_LOCK_M = 35;
const WALK_MAX_DEPTH = 4;
const SPEED_SLACK = 2.5;
const MIN_REACHABLE_M = 150;
const MAX_REACHABLE_M = 2500;
const DEFAULT_REACHABLE_M = 800;
const DIRECTION_PENALTY_M = 40;                  // how many meters of distance one radian of misalignment is "worth"

function segmentGeomLonLat(segment: RailSegment): LonLat[] {
    return segment.geom.map(([lon, lat]) => ({ lon, lat }));
}

function pickBestProjection(
    point: LonLat,
    segments: Iterable<RailSegment>,
    maxDistanceM: number,
    bearingHint?: number,
): { segment: RailSegment; projection: PolylineProjection } | null {
    let best: { segment: RailSegment; projection: PolylineProjection; score: number } | null = null;
    for (const segment of segments) {
        const proj = projectPointOntoPolyline(point, segmentGeomLonLat(segment));
        if (!proj || proj.distanceM > maxDistanceM) continue;
        let score = proj.distanceM;
        if (Number.isFinite(bearingHint)) {
            // Cheap direction tiebreak: smaller of (|seg − hint|, |seg + 180° − hint|),
            // wrapped to [0, π], multiplied by a per-radian meter weight.
            const segRad = proj.bearing * Math.PI / 180;
            const hintRad = (bearingHint as number) * Math.PI / 180;
            const diff = Math.atan2(Math.sin(segRad - hintRad), Math.cos(segRad - hintRad));
            const diffFlip = Math.atan2(Math.sin(segRad + Math.PI - hintRad), Math.cos(segRad + Math.PI - hintRad));
            const penalty = Math.min(Math.abs(diff), Math.abs(diffFlip));
            score += penalty * DIRECTION_PENALTY_M;
        }
        if (!best || score < best.score) {
            best = { segment, projection: proj, score };
        }
    }
    return best && { segment: best.segment, projection: best.projection };
}

function reachableSegmentIds(
    store: ChunkStore,
    prior: SnapPrior,
    distanceBudgetM: number,
): Set<number> {
    const start = store.segmentById(prior.segmentId);
    const reachable = new Set<number>();
    if (!start) return reachable;
    reachable.add(start.id);

    const adjacency = store.adjacency();
    type Visit = { node: number; cost: number; depth: number; lastSegment: number };
    const queue: Visit[] = [];
    if (start.source != null) queue.push({ node: start.source, cost: 0, depth: 0, lastSegment: start.id });
    if (start.target != null) queue.push({ node: start.target, cost: 0, depth: 0, lastSegment: start.id });

    while (queue.length > 0) {
        const visit = queue.shift()!;
        if (visit.depth >= WALK_MAX_DEPTH) continue;
        if (visit.cost > distanceBudgetM) continue;
        const incident = adjacency.get(visit.node);
        if (!incident) continue;
        for (const segId of incident) {
            if (segId === visit.lastSegment) continue;
            const seg = store.segmentById(segId);
            if (!seg) continue;
            // Entering the segment is free — we can be anywhere on it. We
            // only spend its length if we want to walk *past* it.
            if (!reachable.has(segId)) reachable.add(segId);
            const exitCost = visit.cost + seg.lengthM;
            if (exitCost > distanceBudgetM) continue;
            const nextNode = seg.source === visit.node ? seg.target : seg.source;
            if (nextNode != null) queue.push({ node: nextNode, cost: exitCost, depth: visit.depth + 1, lastSegment: segId });
        }
    }
    return reachable;
}

function reachableDistanceBudgetM(input: SnapInput, prior?: SnapPrior): number {
    if (!prior) return DEFAULT_REACHABLE_M;
    const dtSec = input.ts > prior.ts ? (input.ts - prior.ts) / 1000 : 0;
    if (dtSec <= 0) return DEFAULT_REACHABLE_M;
    const speed = input.speedMs ?? 30;
    const raw = Math.max(speed * dtSec * SPEED_SLACK, MIN_REACHABLE_M) + 200;
    return Math.min(raw, MAX_REACHABLE_M);
}

function nearbySegments(store: ChunkStore, point: LonLat): RailSegment[] {
    const out: RailSegment[] = [];
    const lonMin = point.lon - RECOVERY_RADIUS_DEG;
    const lonMax = point.lon + RECOVERY_RADIUS_DEG;
    const latMin = point.lat - RECOVERY_RADIUS_DEG;
    const latMax = point.lat + RECOVERY_RADIUS_DEG;
    for (const seg of store.segments()) {
        // Quick bbox cull against the segment's vertices.
        let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
        for (const [lon, lat] of seg.geom) {
            if (lon < minLon) minLon = lon;
            if (lon > maxLon) maxLon = lon;
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
        }
        if (maxLon < lonMin || minLon > lonMax) continue;
        if (maxLat < latMin || minLat > latMax) continue;
        out.push(seg);
    }
    return out;
}

function projectionToResult(
    segment: RailSegment,
    projection: PolylineProjection,
    via: 'happy' | 'recovery',
): SnapResult {
    return {
        segmentId: segment.id,
        fraction: projection.fraction,
        lon: projection.lon,
        lat: projection.lat,
        bearing: projection.bearing,
        snapDistanceM: projection.distanceM,
        via,
    };
}

function plausiblePriorProjection(
    input: SnapInput,
    prior: SnapPrior,
    segment: RailSegment,
    projection: PolylineProjection,
): boolean {
    if (projection.distanceM > PRIOR_SEGMENT_LOCK_M) return false;

    // A projection clamped to the segment end is often a signal that the
    // train has actually moved onto the next segment. Only lock to that end
    // when the raw point is still very close to it.
    const clampedToEdge = projection.fraction <= 0.001 || projection.fraction >= 0.999;
    if (clampedToEdge && projection.distanceM > PRIOR_EDGE_LOCK_M) {
        const slow = Number.isFinite(input.speedMs) && (input.speedMs as number) <= SLOW_SWITCH_LOCK_SPEED_MS;
        if (!slow || projection.distanceM > SLOW_SWITCH_EDGE_LOCK_M) return false;
    }

    const dtSec = input.ts > prior.ts ? (input.ts - prior.ts) / 1000 : 0;
    if (dtSec <= 0) return true;

    const expected = (input.speedMs ?? 30) * dtSec * SPEED_SLACK + 120;
    const alongM = Math.abs(projection.fraction - prior.fraction) * segment.lengthM;
    return alongM <= Math.max(MIN_REACHABLE_M, expected);
}

export function snap(
    input: SnapInput,
    prior: SnapPrior | undefined,
    store: ChunkStore,
): SnapResult | null {
    const point: LonLat = { lon: input.lon, lat: input.lat };
    const bearingHint = Number.isFinite(input.bearingDeg) ? input.bearingDeg : undefined;

    // Strong continuity lock: if the previous segment still explains the raw
    // point, keep the train there. This prevents GPS noise from pulling trains
    // across parallel tracks that are technically reachable through nearby
    // crossovers or station throats.
    if (prior) {
        const priorSegment = store.segmentById(prior.segmentId);
        if (priorSegment) {
            const priorProjection = projectPointOntoPolyline(point, segmentGeomLonLat(priorSegment));
            if (priorProjection && plausiblePriorProjection(input, prior, priorSegment, priorProjection)) {
                return projectionToResult(priorSegment, priorProjection, 'happy');
            }
        }
    }

    // Happy path.
    if (prior && store.segmentById(prior.segmentId)) {
        const budget = reachableDistanceBudgetM(input, prior);
        const reachableIds = reachableSegmentIds(store, prior, budget);
        const reachableSegments = (function* () {
            for (const id of reachableIds) {
                const seg = store.segmentById(id);
                if (seg) yield seg;
            }
        })();
        const happy = pickBestProjection(point, reachableSegments, HAPPY_DIST_LIMIT_M, bearingHint);
        if (happy) return projectionToResult(happy.segment, happy.projection, 'happy');
    }

    // Recovery: brute-force closest segment in loaded chunks within the radius.
    const recovery = pickBestProjection(point, nearbySegments(store, point), RECOVERY_DIST_LIMIT_M, bearingHint);
    if (recovery) return projectionToResult(recovery.segment, recovery.projection, 'recovery');

    return null;
}

// Helper for callers that want to interpolate along the snapped segment's
// geometry between consecutive same-segment snaps (smoother than chord).
export function sampleSegmentBetweenFractions(
    segment: RailSegment,
    fA: number,
    fB: number,
    t: number,
): { lon: number; lat: number; bearing: number } | null {
    return samplePolylineAt(segmentGeomLonLat(segment), fA + (fB - fA) * t);
}
