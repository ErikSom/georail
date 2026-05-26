import type { ChunkStore } from './chunkStore.ts';
import type { RailSegment } from './api.ts';
import { bearingDeg, haversineDistanceM, type LonLat } from './geom.ts';

export interface TrackAnchor extends LonLat {
    ts: number;
    segmentId: number;
    fraction: number;
    speedMs?: number;
    bearing?: number;
}

export interface OrientedTrackAnchor extends TrackAnchor {
    bearing?: number;
}

export interface TrackRoute {
    points: TrackRoutePoint[];
    lengthM: number;
    via: 'same-segment' | 'graph' | 'transition';
}

export type WorldOffset = [number, number, number];

export interface TrackRoutePoint extends LonLat {
    worldOffset?: WorldOffset;
}

export interface TrackRouteSample extends TrackRoutePoint {
    bearing: number;
    distanceM: number;
    fraction: number;
}

const SAMPLE_STEP_M = 25;
const MAX_SEGMENT_SAMPLES = 80;
const PAIR_SPEED_SLACK = 2.75;
const PAIR_MIN_ROUTE_M = 750;
const PAIR_MAX_ROUTE_M = 10_000;
const BEARING_WINDOW_M = 20;
const STATIC_ROUTE_MAX_SEGMENTS = 4;
const ROUTE_DIRECTION_FREE_DEG = 45;
const ROUTE_DIRECTION_PENALTY_M_PER_DEG = 20;
const DIRECT_TRANSITION_MAX_M = 220;
const DIRECT_TRANSITION_GRAPH_RATIO = 3;
const DIRECT_TRANSITION_GRAPH_EXTRA_M = 60;
const DIRECT_TRANSITION_DIRECTION_PENALTY_M = 1_000;

function segmentRoutePoints(segment: RailSegment): TrackRoutePoint[] {
    return segment.geom.map(([lon, lat], index) => {
        const worldOffset = segment.worldOffsets?.[index];
        return worldOffset
            ? { lon, lat, worldOffset }
            : { lon, lat };
    });
}

function polylineLengthM(points: LonLat[]): number {
    let total = 0;
    for (let i = 1; i < points.length; i++) {
        total += haversineDistanceM(points[i - 1], points[i]);
    }
    return total;
}

function appendDedupe(out: TrackRoutePoint[], points: TrackRoutePoint[]): void {
    for (const point of points) {
        const last = out[out.length - 1];
        if (last && Math.abs(last.lon - point.lon) < 1e-9 && Math.abs(last.lat - point.lat) < 1e-9) {
            continue;
        }
        out.push(point);
    }
}

function angleDeltaDeg(a: number, b: number): number {
    return Math.abs(((((a - b) % 360) + 540) % 360) - 180);
}

function interpolateWorldOffset(
    a: TrackRoutePoint,
    b: TrackRoutePoint,
    t: number,
): WorldOffset | undefined {
    if (!a.worldOffset || !b.worldOffset) return a.worldOffset ?? b.worldOffset;
    return [
        a.worldOffset[0] + (b.worldOffset[0] - a.worldOffset[0]) * t,
        a.worldOffset[1] + (b.worldOffset[1] - a.worldOffset[1]) * t,
        a.worldOffset[2] + (b.worldOffset[2] - a.worldOffset[2]) * t,
    ];
}

function sampleRoutePointAt(
    points: TrackRoutePoint[],
    fraction: number,
): TrackRouteSample | null {
    if (!Array.isArray(points) || points.length < 2) return null;
    const f = Math.max(0, Math.min(1, fraction));
    const edgeLengths: number[] = [];
    let total = 0;
    for (let i = 0; i < points.length - 1; i++) {
        const len = haversineDistanceM(points[i], points[i + 1]);
        edgeLengths.push(len);
        total += len;
    }
    if (total <= 0) {
        const first = points[0];
        return {
            lon: first.lon,
            lat: first.lat,
            bearing: 0,
            worldOffset: first.worldOffset,
            distanceM: 0,
            fraction: 0,
        };
    }

    const target = f * total;
    let accumulated = 0;
    for (let i = 0; i < edgeLengths.length; i++) {
        const next = accumulated + edgeLengths[i];
        if (target <= next || i === edgeLengths.length - 1) {
            const local = edgeLengths[i] > 0 ? (target - accumulated) / edgeLengths[i] : 0;
            const a = points[i], b = points[i + 1];
            return {
                lon: a.lon + local * (b.lon - a.lon),
                lat: a.lat + local * (b.lat - a.lat),
                bearing: bearingDeg(a, b),
                worldOffset: interpolateWorldOffset(a, b, local),
                distanceM: target,
                fraction: f,
            };
        }
        accumulated = next;
    }
    const last = points[points.length - 1];
    return {
        lon: last.lon,
        lat: last.lat,
        bearing: 0,
        worldOffset: last.worldOffset,
        distanceM: total,
        fraction: 1,
    };
}

function sliceSegment(segment: RailSegment, fromFraction: number, toFraction: number): TrackRoutePoint[] {
    const distanceM = Math.abs(toFraction - fromFraction) * Math.max(1, segment.lengthM);
    const steps = Math.max(1, Math.min(MAX_SEGMENT_SAMPLES, Math.ceil(distanceM / SAMPLE_STEP_M)));
    const geom = segmentRoutePoints(segment);
    const points: TrackRoutePoint[] = [];
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const fraction = fromFraction + (toFraction - fromFraction) * t;
        const sample = sampleRoutePointAt(geom, fraction);
        if (sample) points.push({
            lon: sample.lon,
            lat: sample.lat,
            worldOffset: sample.worldOffset,
        });
    }
    return points;
}

function nodeForDirection(segment: RailSegment, direction: 'source' | 'target'): number | null {
    return direction === 'source' ? segment.source : segment.target;
}

function fractionForNode(segment: RailSegment, node: number): number | null {
    if (segment.source === node) return 0;
    if (segment.target === node) return 1;
    return null;
}

function oppositeNode(segment: RailSegment, node: number): number | null {
    if (segment.source === node) return segment.target;
    if (segment.target === node) return segment.source;
    return null;
}

function segmentBearingAtFraction(segment: RailSegment, fraction: number): number {
    const geom = segmentRoutePoints(segment);
    const delta = segment.lengthM > 0
        ? Math.min(0.05, Math.max(0.001, BEARING_WINDOW_M / segment.lengthM))
        : 0.01;
    const before = sampleRoutePointAt(geom, Math.max(0, fraction - delta));
    const after = sampleRoutePointAt(geom, Math.min(1, fraction + delta));
    if (before && after && haversineDistanceM(before, after) > 0.2) {
        return bearingDeg(before, after);
    }
    if (geom.length >= 2) return bearingDeg(geom[0], geom[geom.length - 1]);
    return 0;
}

function headingUsesIncreasingFraction(anchor: OrientedTrackAnchor, segment: RailSegment): boolean {
    const forward = segmentBearingAtFraction(segment, anchor.fraction);
    const bearing = Number.isFinite(anchor.bearing) ? anchor.bearing as number : forward;
    return angleDeltaDeg(bearing, forward) <= angleDeltaDeg(bearing, (forward + 180) % 360);
}

function routeEndBearing(points: TrackRoutePoint[]): number | null {
    if (points.length < 2) return null;
    return bearingDeg(points[points.length - 2], points[points.length - 1]);
}

function routeStartBearing(points: TrackRoutePoint[]): number | null {
    if (points.length < 2) return null;
    return bearingDeg(points[0], points[1]);
}

function directionPenaltyM(routeBearing: number | null, desiredBearing: number | null): number {
    if (routeBearing == null || desiredBearing == null) return 0;
    const excessDeg = Math.max(0, angleDeltaDeg(routeBearing, desiredBearing) - ROUTE_DIRECTION_FREE_DEG);
    return excessDeg * ROUTE_DIRECTION_PENALTY_M_PER_DEG;
}

function routeDirectionPenaltyM(from: TrackAnchor, to: TrackAnchor, points: TrackRoutePoint[]): number {
    const directDistanceM = haversineDistanceM(from, to);
    const directBearing = directDistanceM > 10 ? bearingDeg(from, to) : null;
    const desiredStart = Number.isFinite(from.bearing) ? from.bearing as number : directBearing;
    const desiredEnd = Number.isFinite(to.bearing) ? to.bearing as number : directBearing;

    return directionPenaltyM(routeStartBearing(points), desiredStart)
        + directionPenaltyM(routeEndBearing(points), desiredEnd);
}

function bestPreviousSegment(
    store: ChunkStore,
    node: number | null,
    desiredBearing: number | null,
    visited: Set<number>,
): { segment: RailSegment; farNode: number | null; points: TrackRoutePoint[] } | null {
    if (node == null) return null;
    const incident = store.adjacency().get(node);
    if (!incident) return null;

    let best: { segment: RailSegment; farNode: number | null; points: TrackRoutePoint[]; score: number } | null = null;
    for (const segmentId of incident) {
        if (visited.has(segmentId)) continue;
        const segment = store.segmentById(segmentId);
        if (!segment) continue;

        const nodeFraction = fractionForNode(segment, node);
        if (nodeFraction == null) continue;
        const farNode = oppositeNode(segment, node);
        const farFraction = nodeFraction === 0 ? 1 : 0;
        const points = sliceSegment(segment, farFraction, nodeFraction);
        if (points.length < 2) continue;

        const bearingIntoNode = routeEndBearing(points);
        const score = desiredBearing != null && bearingIntoNode != null
            ? angleDeltaDeg(bearingIntoNode, desiredBearing)
            : 0;

        if (!best || score < best.score || (score === best.score && segment.lengthM > best.segment.lengthM)) {
            best = { segment, farNode, points, score };
        }
    }

    return best;
}

function routeBudgetM(from: TrackAnchor, to: TrackAnchor): number {
    const dtSec = Math.max(0, (to.ts - from.ts) / 1000);
    const speed = Math.max(from.speedMs ?? 0, to.speedMs ?? 0, 20);
    const speedBudget = speed * dtSec * PAIR_SPEED_SLACK + 300;
    const directBudget = haversineDistanceM(from, to) * 4 + 300;
    return Math.min(PAIR_MAX_ROUTE_M, Math.max(PAIR_MIN_ROUTE_M, speedBudget, directBudget));
}

function directTransitionRoute(from: TrackAnchor, to: TrackAnchor): TrackRoute | null {
    const lengthM = haversineDistanceM(from, to);
    if (!Number.isFinite(lengthM) || lengthM <= 0.2) return null;
    return {
        points: [
            { lon: from.lon, lat: from.lat },
            { lon: to.lon, lat: to.lat },
        ],
        lengthM,
        via: 'transition',
    };
}

function shouldUseDirectTransition(
    from: TrackAnchor,
    to: TrackAnchor,
    best: { costM: number; scoreM: number; points: TrackRoutePoint[] } | null,
): boolean {
    const directM = haversineDistanceM(from, to);
    if (!Number.isFinite(directM) || directM > DIRECT_TRANSITION_MAX_M) return false;
    if (!best) return true;

    const directionPenaltyM = routeDirectionPenaltyM(from, to, best.points);
    return best.costM > directM * DIRECT_TRANSITION_GRAPH_RATIO + DIRECT_TRANSITION_GRAPH_EXTRA_M ||
        directionPenaltyM >= DIRECT_TRANSITION_DIRECTION_PENALTY_M;
}

interface NodePathStep {
    segment: RailSegment;
    fromNode: number;
    toNode: number;
}

interface NodePath {
    costM: number;
    steps: NodePathStep[];
}

function shortestNodePath(
    store: ChunkStore,
    startNode: number,
    endNode: number,
    maxCostM: number,
    excludedSegmentIds: Set<number>,
): NodePath | null {
    if (startNode === endNode) return { costM: 0, steps: [] };

    type QueueItem = { node: number; costM: number; steps: NodePathStep[] };
    const queue: QueueItem[] = [{ node: startNode, costM: 0, steps: [] }];
    const bestCost = new Map<number, number>([[startNode, 0]]);
    const adjacency = store.adjacency();

    while (queue.length > 0) {
        queue.sort((a, b) => a.costM - b.costM);
        const current = queue.shift()!;
        if (current.costM > maxCostM) continue;
        if (current.node === endNode) return { costM: current.costM, steps: current.steps };
        if (current.costM > (bestCost.get(current.node) ?? Infinity)) continue;

        const incident = adjacency.get(current.node);
        if (!incident) continue;
        for (const segmentId of incident) {
            if (excludedSegmentIds.has(segmentId)) continue;
            const segment = store.segmentById(segmentId);
            if (!segment) continue;
            const nextNode = oppositeNode(segment, current.node);
            if (nextNode == null) continue;
            const nextCost = current.costM + segment.lengthM;
            if (nextCost > maxCostM || nextCost >= (bestCost.get(nextNode) ?? Infinity)) continue;
            bestCost.set(nextNode, nextCost);
            queue.push({
                node: nextNode,
                costM: nextCost,
                steps: [...current.steps, { segment, fromNode: current.node, toNode: nextNode }],
            });
        }
    }

    return null;
}

function buildPointsForChoice(
    from: TrackAnchor,
    to: TrackAnchor,
    startSegment: RailSegment,
    endSegment: RailSegment,
    startNode: number,
    endNode: number,
    path: NodePath,
): TrackRoutePoint[] | null {
    const startFraction = fractionForNode(startSegment, startNode);
    const endFraction = fractionForNode(endSegment, endNode);
    if (startFraction == null || endFraction == null) return null;

    const points: TrackRoutePoint[] = [];
    appendDedupe(points, sliceSegment(startSegment, from.fraction, startFraction));
    for (const step of path.steps) {
        const fromFraction = fractionForNode(step.segment, step.fromNode);
        const toFraction = fractionForNode(step.segment, step.toNode);
        if (fromFraction == null || toFraction == null) return null;
        appendDedupe(points, sliceSegment(step.segment, fromFraction, toFraction));
    }
    appendDedupe(points, sliceSegment(endSegment, endFraction, to.fraction));
    return points.length >= 2 ? points : null;
}

export function buildTrackRoute(
    from: TrackAnchor,
    to: TrackAnchor,
    store: ChunkStore,
): TrackRoute | null {
    const startSegment = store.segmentById(from.segmentId);
    const endSegment = store.segmentById(to.segmentId);
    if (!startSegment || !endSegment) return null;

    if (from.segmentId === to.segmentId) {
        const points = sliceSegment(startSegment, from.fraction, to.fraction);
        return points.length >= 2
            ? { points, lengthM: polylineLengthM(points), via: 'same-segment' }
            : null;
    }

    const budget = routeBudgetM(from, to);
    const excluded = new Set([from.segmentId, to.segmentId]);
    let best: { costM: number; scoreM: number; points: TrackRoutePoint[] } | null = null;

    for (const startDir of ['source', 'target'] as const) {
        const startNode = nodeForDirection(startSegment, startDir);
        if (startNode == null) continue;
        const startPartialM = Math.abs(from.fraction - (startDir === 'source' ? 0 : 1)) * startSegment.lengthM;

        for (const endDir of ['source', 'target'] as const) {
            const endNode = nodeForDirection(endSegment, endDir);
            if (endNode == null) continue;
            const endPartialM = Math.abs(to.fraction - (endDir === 'source' ? 0 : 1)) * endSegment.lengthM;
            const remainingBudget = budget - startPartialM - endPartialM;
            if (remainingBudget < 0) continue;

            const path = shortestNodePath(store, startNode, endNode, remainingBudget, excluded);
            if (!path) continue;
            const totalCost = startPartialM + path.costM + endPartialM;
            if (totalCost > budget) continue;
            const points = buildPointsForChoice(from, to, startSegment, endSegment, startNode, endNode, path);
            if (!points) continue;

            const scoreM = totalCost + routeDirectionPenaltyM(from, to, points);
            if (!best || scoreM < best.scoreM || (scoreM === best.scoreM && totalCost < best.costM)) {
                best = { costM: totalCost, scoreM, points };
            }
        }
    }

    if (shouldUseDirectTransition(from, to, best)) {
        return directTransitionRoute(from, to);
    }

    return best
        ? { points: best.points, lengthM: polylineLengthM(best.points), via: 'graph' }
        : null;
}

export function buildTrackRouteBehind(
    anchor: OrientedTrackAnchor,
    store: ChunkStore,
    distanceBehindM: number,
): TrackRoute | null {
    const segment = store.segmentById(anchor.segmentId);
    if (!segment || !Number.isFinite(anchor.fraction)) return null;

    const targetDistanceM = Math.max(0, distanceBehindM);
    const increasing = headingUsesIncreasingFraction(anchor, segment);
    const segmentFractionBudget = segment.lengthM > 0 ? targetDistanceM / segment.lengthM : 0;
    const currentStartFraction = increasing
        ? Math.max(0, anchor.fraction - segmentFractionBudget)
        : Math.min(1, anchor.fraction + segmentFractionBudget);

    const points: TrackRoutePoint[] = [];
    appendDedupe(points, sliceSegment(segment, currentStartFraction, anchor.fraction));

    let routeLengthM = polylineLengthM(points);
    let behindNode: number | null = null;
    if (routeLengthM + 0.5 < targetDistanceM) {
        behindNode = increasing
            ? nodeForDirection(segment, 'source')
            : nodeForDirection(segment, 'target');
    }

    const visited = new Set<number>([segment.id]);
    let prependBearing = routeEndBearing(points);
    for (let i = 0; i < STATIC_ROUTE_MAX_SEGMENTS && behindNode != null && routeLengthM + 0.5 < targetDistanceM; i++) {
        const previous = bestPreviousSegment(store, behindNode, prependBearing, visited);
        if (!previous) break;
        visited.add(previous.segment.id);
        points.unshift(...previous.points.slice(0, -1));
        routeLengthM = polylineLengthM(points);
        behindNode = previous.farNode;
        prependBearing = routeEndBearing(previous.points);
    }

    if (points.length < 2) return null;
    return {
        points,
        lengthM: polylineLengthM(points),
        via: visited.size > 1 ? 'graph' : 'same-segment',
    };
}

export function sampleTrackRoute(
    route: TrackRoute,
    t: number,
): TrackRouteSample | null {
    const f = Math.max(0, Math.min(1, t));
    const sample = sampleRoutePointAt(route.points, f);
    if (!sample) return null;

    const delta = route.lengthM > 0
        ? Math.min(0.2, Math.max(0.0001, BEARING_WINDOW_M / route.lengthM))
        : 0.01;
    const before = sampleRoutePointAt(route.points, Math.max(0, f - delta));
    const after = sampleRoutePointAt(route.points, Math.min(1, f + delta));
    if (before && after && haversineDistanceM(before, after) > 0.2) {
        return { ...sample, bearing: bearingDeg(before, after) };
    }
    return sample;
}

export function sampleTrackRouteAtDistance(
    route: TrackRoute,
    distanceM: number,
): TrackRouteSample | null {
    const clamped = Math.max(0, Math.min(route.lengthM, distanceM));
    if (route.lengthM <= 0) return sampleTrackRoute(route, 0);
    return sampleTrackRoute(route, clamped / route.lengthM);
}

export function progressWithEndpointSpeeds(
    t: number,
    durationMs: number,
    distanceM: number,
    startSpeedMs?: number,
    endSpeedMs?: number,
): number {
    const u = Math.max(0, Math.min(1, t));
    const durationSec = durationMs / 1000;
    if (!Number.isFinite(durationSec) || durationSec <= 0) return u;
    if (!Number.isFinite(distanceM) || distanceM <= 0.01) return u;

    const averageSpeed = distanceM / durationSec;
    if (!Number.isFinite(averageSpeed) || averageSpeed <= 0.01) return u;

    const clampSpeed = (speed: number | undefined): number => {
        if (!Number.isFinite(speed) || (speed as number) < 0) return averageSpeed;
        return Math.min(speed as number, averageSpeed * 2.5);
    };

    let m0 = clampSpeed(startSpeedMs) / averageSpeed;
    let m1 = clampSpeed(endSpeedMs) / averageSpeed;

    // Sufficient monotonicity guard for a cubic Hermite 0→1 curve. If NS
    // speed samples disagree with the snapshot distance, keep the profile
    // smooth but prevent backwards movement and overshoot.
    const slopeSum = m0 + m1;
    if (slopeSum > 3) {
        const scale = 3 / slopeSum;
        m0 *= scale;
        m1 *= scale;
    }

    const u2 = u * u;
    const u3 = u2 * u;
    const h10 = u3 - 2 * u2 + u;
    const h01 = -2 * u3 + 3 * u2;
    const h11 = u3 - u2;
    const eased = h10 * m0 + h01 + h11 * m1;
    return Math.max(0, Math.min(1, eased));
}
