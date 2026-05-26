// Per-train rolling buffer of *snapped* positions, plus the interpolation
// step that turns the buffer into a continuous (lon, lat, bearing) over
// time. Render lag (so we always have a future snapshot ahead of the
// playhead) is the only knob.

import type { ChunkStore } from './chunkStore.ts';
import { bearingDeg, haversineDistanceM, type LonLat } from './geom.ts';
import { snap } from './snap.ts';
import {
    buildTrackRouteBehind,
    buildTrackRoute,
    progressWithEndpointSpeeds,
    sampleTrackRouteAtDistance,
    type TrackRoute,
    type WorldOffset,
} from './trackRoute.ts';

export interface RawSample extends LonLat {
    ts: number;
    speedMs?: number;
    bearingDeg?: number;
}

export interface SnappedFrame {
    ts: number;
    lon: number;
    lat: number;
    bearing: number;
    segmentId: number;
    fraction: number;
    via: 'happy' | 'recovery';
    snapDistanceM: number;
    speedMs?: number;
    reportedBearingDeg?: number;
}

export interface InterpolatedFrame {
    lon: number;
    lat: number;
    bearing: number;
    worldOffset?: WorldOffset;
    status: 'playing' | 'live edge' | 'buffering' | 'single snapshot' | 'loading path' | 'no data';
}

export interface RoutePlaybackFrame extends InterpolatedFrame {
    route?: TrackRoute;
    routeKey?: string;
    routeDistanceM?: number;
    routeLengthM?: number;
}

export interface ConsistSample extends InterpolatedFrame {
    offsetM: number;
    routeKey: string;
    routeDistanceM: number;
    routeLengthM: number;
}

const MAX_FRAMES = 8;
const DUPLICATE_POSITION_EPSILON_M = 5;
const MOVING_SPEED_EPSILON_MS = 2;
const STOPPED_JITTER_HOLD_M = 45;
const SLOW_JITTER_HOLD_M = 18;
const OPPOSITE_MOVEMENT_MIN_M = 12;
const OPPOSITE_MOVEMENT_REJECT_DEG = 120;

interface CachedRoute {
    storeVersion: number;
    route: TrackRoute | null;
}

interface TimelineRoute {
    key: string;
    route: TrackRoute;
    startM: number;
    endM: number;
}

// All trains observed in the current session. Keyed by train id.
export class TrainTracker {
    private store: ChunkStore;
    private frames = new Map<string, SnappedFrame[]>();
    private lastRawTs = new Map<string, number>();
    private routes = new Map<string, CachedRoute>();

    constructor(store: ChunkStore) {
        this.store = store;
    }

    // Feed one raw NS position. Returns the snap result if it produced a
    // new snapped frame, or null if the position was duplicate/stale or
    // we couldn't snap it (no rail chunk loaded around the point yet).
    public ingest(id: string, sample: RawSample): SnappedFrame | null {
        const previousTs = this.lastRawTs.get(id);
        if (previousTs !== undefined && sample.ts <= previousTs) {
            return null;
        }
        const prior = this.latestFrame(id);
        const snapped = snap(
            {
                lon: sample.lon,
                lat: sample.lat,
                ts: sample.ts,
                speedMs: sample.speedMs,
                bearingDeg: sample.bearingDeg,
            },
            prior ? { segmentId: prior.segmentId, fraction: prior.fraction, ts: prior.ts } : undefined,
            this.store,
        );
        if (!snapped) return null;

        let frame: SnappedFrame = {
            ts: sample.ts,
            lon: snapped.lon,
            lat: snapped.lat,
            bearing: snapped.bearing,
            segmentId: snapped.segmentId,
            fraction: snapped.fraction,
            via: snapped.via,
            snapDistanceM: snapped.snapDistanceM,
            speedMs: sample.speedMs,
            reportedBearingDeg: Number.isFinite(sample.bearingDeg) ? sample.bearingDeg : undefined,
        };
        const buffer = this.frames.get(id) ?? [];
        if (prior) {
            const movementM = haversineDistanceM(prior, frame);
            const speedMs = sample.speedMs ?? prior.speedMs ?? 0;
            if (movementM < DUPLICATE_POSITION_EPSILON_M && speedMs > MOVING_SPEED_EPSILON_MS) {
                this.lastRawTs.set(id, sample.ts);
                return null;
            }
            const stationaryHoldM = this.stationaryHoldDistanceM(speedMs);
            if (stationaryHoldM > 0 && movementM <= stationaryHoldM) {
                frame = this.heldFrameFromPrior(prior, sample);
            } else if (this.frameDisagreesWithReportedMovement(prior, frame, sample, movementM, speedMs)) {
                this.lastRawTs.set(id, sample.ts);
                return null;
            }
        }

        this.lastRawTs.set(id, sample.ts);
        buffer.push(frame);
        if (buffer.length > MAX_FRAMES) buffer.splice(0, buffer.length - MAX_FRAMES);
        this.frames.set(id, buffer);
        this.pruneRouteCacheFor(id, buffer);
        return frame;
    }

    public ingestMany(id: string, samples: RawSample[]): void {
        for (const sample of samples) this.ingest(id, sample);
    }

    public dropMissing(activeIds: Set<string>): number {
        let dropped = 0;
        for (const id of this.frames.keys()) {
            if (!activeIds.has(id)) {
                this.frames.delete(id);
                this.lastRawTs.delete(id);
                this.deleteRouteCacheFor(id);
                dropped++;
            }
        }
        return dropped;
    }

    public framesFor(id: string): SnappedFrame[] {
        return this.frames.get(id) ?? [];
    }

    public allIds(): IterableIterator<string> {
        return this.frames.keys();
    }

    private latestFrame(id: string): SnappedFrame | undefined {
        const buffer = this.frames.get(id);
        return buffer && buffer.length > 0 ? buffer[buffer.length - 1] : undefined;
    }

    private routeKey(id: string, prev: SnappedFrame, next: SnappedFrame): string {
        return `${id}:${prev.ts}:${prev.segmentId}:${prev.fraction.toFixed(6)}>${next.ts}:${next.segmentId}:${next.fraction.toFixed(6)}`;
    }

    private routeForPair(id: string, prev: SnappedFrame, next: SnappedFrame): TrackRoute | null {
        const key = this.routeKey(id, prev, next);
        const storeVersion = this.store.version();
        const cached = this.routes.get(key);
        if (cached && cached.storeVersion === storeVersion) return cached.route;

        const route = buildTrackRoute(
            {
                lon: prev.lon,
                lat: prev.lat,
                ts: prev.ts,
                segmentId: prev.segmentId,
                fraction: prev.fraction,
                speedMs: prev.speedMs,
                bearing: prev.reportedBearingDeg ?? prev.bearing,
            },
            {
                lon: next.lon,
                lat: next.lat,
                ts: next.ts,
                segmentId: next.segmentId,
                fraction: next.fraction,
                speedMs: next.speedMs,
                bearing: next.reportedBearingDeg ?? next.bearing,
            },
            this.store,
        );
        this.routes.set(key, { storeVersion, route });
        return route;
    }

    private pruneRouteCacheFor(id: string, frames: SnappedFrame[]): void {
        const valid = new Set<string>();
        for (let i = 1; i < frames.length; i++) {
            valid.add(this.routeKey(id, frames[i - 1], frames[i]));
        }
        const prefix = `${id}:`;
        for (const key of this.routes.keys()) {
            if (key.startsWith(prefix) && !valid.has(key)) this.routes.delete(key);
        }
    }

    private deleteRouteCacheFor(id: string): void {
        const prefix = `${id}:`;
        for (const key of this.routes.keys()) {
            if (key.startsWith(prefix)) this.routes.delete(key);
        }
    }

    private isStationaryPair(prev: SnappedFrame, next: SnappedFrame): boolean {
        const movementM = haversineDistanceM(prev, next);
        const speedMs = Math.max(prev.speedMs ?? 0, next.speedMs ?? 0);
        return movementM < DUPLICATE_POSITION_EPSILON_M && speedMs <= MOVING_SPEED_EPSILON_MS;
    }

    private frameBearing(frame: SnappedFrame): number {
        return frame.reportedBearingDeg ?? frame.bearing;
    }

    private stationaryHoldDistanceM(speedMs: number): number {
        if (speedMs <= 0.5) return STOPPED_JITTER_HOLD_M;
        if (speedMs <= MOVING_SPEED_EPSILON_MS) return SLOW_JITTER_HOLD_M;
        return 0;
    }

    private heldFrameFromPrior(prior: SnappedFrame, sample: RawSample): SnappedFrame {
        return {
            ...prior,
            ts: sample.ts,
            speedMs: sample.speedMs,
            reportedBearingDeg: Number.isFinite(sample.bearingDeg) ? sample.bearingDeg : prior.reportedBearingDeg,
            snapDistanceM: 0,
            via: 'happy',
        };
    }

    private frameDisagreesWithReportedMovement(
        prior: SnappedFrame,
        frame: SnappedFrame,
        sample: RawSample,
        movementM: number,
        speedMs: number,
    ): boolean {
        if (speedMs <= MOVING_SPEED_EPSILON_MS) return false;
        if (movementM < OPPOSITE_MOVEMENT_MIN_M) return false;
        if (!Number.isFinite(sample.bearingDeg)) return false;

        const movementBearing = bearingDeg(prior, frame);
        const reportedBearing = sample.bearingDeg as number;
        const diff = Math.abs(((((movementBearing - reportedBearing) % 360) + 540) % 360) - 180);
        return diff > OPPOSITE_MOVEMENT_REJECT_DEG;
    }

    private staticRouteKey(id: string, frame: SnappedFrame, maxOffsetM: number): string {
        return `${id}:static:${frame.ts}:${frame.segmentId}:${frame.fraction.toFixed(6)}:${Math.ceil(maxOffsetM)}`;
    }

    private staticSamplesBehindFrame(
        id: string,
        frame: SnappedFrame,
        offsetsM: number[],
    ): ConsistSample[] | null {
        const maxOffsetM = Math.max(0, ...offsetsM);
        const key = this.staticRouteKey(id, frame, maxOffsetM);
        const storeVersion = this.store.version();
        const cached = this.routes.get(key);
        const route = cached && cached.storeVersion === storeVersion
            ? cached.route
            : buildTrackRouteBehind(
                {
                    lon: frame.lon,
                    lat: frame.lat,
                    ts: frame.ts,
                    segmentId: frame.segmentId,
                    fraction: frame.fraction,
                    speedMs: frame.speedMs,
                    bearing: this.frameBearing(frame),
                },
                this.store,
                maxOffsetM + 5,
            );

        if (!cached || cached.storeVersion !== storeVersion) {
            this.routes.set(key, { storeVersion, route });
        }

        if (!route || route.lengthM + 0.5 < maxOffsetM) return null;

        const samples: ConsistSample[] = [];
        for (const offsetM of offsetsM) {
            const sample = sampleTrackRouteAtDistance(route, route.lengthM - offsetM);
            if (!sample) return null;
            samples.push({
                ...sample,
                status: 'single snapshot',
                offsetM,
                routeKey: key,
                routeDistanceM: sample.distanceM,
                routeLengthM: route.lengthM,
            });
        }
        return samples;
    }

    private timelineRoutesFor(id: string, frames: SnappedFrame[], throughPairIndex: number): TimelineRoute[] {
        const routes: TimelineRoute[] = [];
        let cursorM = 0;
        for (let i = 1; i <= throughPairIndex; i++) {
            const prev = frames[i - 1];
            const next = frames[i];
            const route = this.routeForPair(id, prev, next);
            if (!route) {
                // Keep distance monotonic even if one older route cannot be built.
                // Sampling will clamp to the nearest available route instead of
                // hiding the train at a snapshot boundary.
                continue;
            }
            const startM = cursorM;
            const endM = startM + route.lengthM;
            routes.push({
                key: this.routeKey(id, prev, next),
                route,
                startM,
                endM,
            });
            cursorM = endM;
        }
        return routes;
    }

    private sampleTimelineAt(routes: TimelineRoute[], distanceM: number, offsetM: number): ConsistSample | null {
        if (routes.length === 0) return null;
        const first = routes[0];
        const last = routes[routes.length - 1];
        if (distanceM < first.startM || distanceM > last.endM) return null;
        const route = routes.find((candidate) => distanceM >= candidate.startM && distanceM <= candidate.endM) ?? last;
        const sample = sampleTrackRouteAtDistance(route.route, distanceM - route.startM);
        if (!sample) return null;
        return {
            ...sample,
            status: 'playing',
            offsetM,
            routeKey: route.key,
            routeDistanceM: sample.distanceM,
            routeLengthM: route.route.lengthM,
        };
    }

    // Interpolate the train's position at the given render time. Adjacent
    // snapshots are resolved to a rail route over the currently loaded chunk
    // graph, then sampled by time. If the needed chunks are not loaded yet,
    // hold on the nearest snapped endpoint instead of drawing a line across
    // land.
    public playbackAt(id: string, renderTs: number): RoutePlaybackFrame | null {
        const frames = this.frames.get(id);
        if (!frames || frames.length === 0) return null;
        if (frames.length === 1) {
            const only = frames[0];
            return {
                lon: only.lon, lat: only.lat, bearing: this.frameBearing(only),
                status: 'single snapshot',
            };
        }
        const first = frames[0];
        const last = frames[frames.length - 1];
        if (renderTs <= first.ts) {
            return { lon: first.lon, lat: first.lat, bearing: this.frameBearing(first), status: 'buffering' };
        }
        if (renderTs >= last.ts) {
            return { lon: last.lon, lat: last.lat, bearing: this.frameBearing(last), status: 'live edge' };
        }
        for (let i = 1; i < frames.length; i++) {
            const prev = frames[i - 1];
            const next = frames[i];
            if (renderTs < prev.ts || renderTs > next.ts) continue;
            const span = next.ts - prev.ts;
            const t = span > 0 ? (renderTs - prev.ts) / span : 0;

            const route = this.routeForPair(id, prev, next);
            if (route) {
                const key = this.routeKey(id, prev, next);
                const routeT = progressWithEndpointSpeeds(
                    t,
                    span,
                    route.lengthM,
                    prev.speedMs,
                    next.speedMs,
                );
                const routeDistanceM = routeT * route.lengthM;
                const sample = sampleTrackRouteAtDistance(route, routeDistanceM);
                if (sample) {
                    return {
                        ...sample,
                        status: 'playing',
                        route,
                        routeKey: key,
                        routeDistanceM,
                        routeLengthM: route.lengthM,
                    };
                }
            }

            const fallback = t < 0.5 ? prev : next;
            return {
                lon: fallback.lon,
                lat: fallback.lat,
                bearing: this.frameBearing(fallback),
                status: 'loading path',
            };
        }
        return null;
    }

    public interpolateAt(id: string, renderTs: number): InterpolatedFrame | null {
        return this.playbackAt(id, renderTs);
    }

    public samplesAtOffsets(id: string, renderTs: number, offsetsM: number[]): ConsistSample[] | null {
        const frames = this.frames.get(id);
        if (!frames || frames.length === 0) return null;
        if (frames.length === 1) return this.staticSamplesBehindFrame(id, frames[0], offsetsM);

        let pairIndex = -1;
        for (let i = 1; i < frames.length; i++) {
            if (renderTs >= frames[i - 1].ts && renderTs <= frames[i].ts) {
                pairIndex = i;
                break;
            }
        }
        if (pairIndex < 1) {
            const fallback = renderTs <= frames[0].ts ? frames[0] : frames[frames.length - 1];
            return this.staticSamplesBehindFrame(id, fallback, offsetsM);
        }
        const pairIsStationary = this.isStationaryPair(frames[pairIndex - 1], frames[pairIndex]);

        const playback = this.playbackAt(id, renderTs);
        if (!playback?.route || playback.routeDistanceM == null) {
            return pairIsStationary ? this.staticSamplesBehindFrame(id, frames[pairIndex], offsetsM) : null;
        }

        const routes = this.timelineRoutesFor(id, frames, pairIndex);
        const currentRoute = routes[routes.length - 1];
        if (!currentRoute) {
            return pairIsStationary ? this.staticSamplesBehindFrame(id, frames[pairIndex], offsetsM) : null;
        }
        const headTimelineM = currentRoute.startM + playback.routeDistanceM;
        const samples: ConsistSample[] = [];
        for (const offsetM of offsetsM) {
            const sample = this.sampleTimelineAt(routes, headTimelineM - offsetM, offsetM);
            if (!sample) {
                return pairIsStationary ? this.staticSamplesBehindFrame(id, frames[pairIndex], offsetsM) : null;
            }
            samples.push(sample);
        }
        return samples;
    }

    public trailLineCoordinatesFor(id: string): [number, number][][] {
        const frames = this.frames.get(id);
        if (!frames || frames.length < 2) return [];
        const lines: [number, number][][] = [];
        for (let i = 1; i < frames.length; i++) {
            const route = this.routeForPair(id, frames[i - 1], frames[i]);
            if (!route || route.points.length < 2) continue;
            lines.push(route.points.map((point) => [point.lon, point.lat]));
        }
        return lines;
    }
}
