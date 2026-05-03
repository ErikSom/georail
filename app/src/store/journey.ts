import { signal, computed } from "@preact/signals";
import type { RouteData, RouteStop } from "../lib/api/navigation";
import { calculateStopTimes, fetchJourneyRoute } from "../lib/api/navigation";
import type Path from "../lib/utils/Path";
import { trainDistanceTraveled, trainPathTotalLength, trainVelocityKmh, trainLength, resetTrain, trainDoorsOpen } from "./train";
import { configs, scaledDeltaTime } from "./globals";
import { startJourneySession as apiStartJourney, reportStationArrival, type StationArrivalResponse, type ActiveSession, fetchActiveJourneySession, discardActiveJourneySession as apiDiscardActiveSession } from "../lib/api/journey";
export type { ActiveSession } from "../lib/api/journey";
import { fetchSharedUserRoute } from "../lib/api/userRoutes";
import { country } from "./globals";

export const routeData = signal<RouteData | null>(null);
export const journeyStartTime = signal<number | null>(null);
export const currentRouteIndex = signal(0);

export interface StopStatus {
    arrived: boolean;           // Has the train arrived at this stop?
    departed: boolean;          // Has the train departed from this stop?
    actualArrivalTime: number | null;    // When did train actually arrive (minutes)
    actualDepartureTime: number | null;  // When did train actually depart (minutes)
    arrivalDelta: number | null;
    departureDelta: number | null;
}

export const stopStatuses = signal<StopStatus[]>([]);
export const journeySessionId = signal<string | null>(null);
export const journeyCompleted = signal(false);
export const stationArrivalResults = signal<StationArrivalResponse[]>([]);
export const alreadyVisitedStations = signal<Set<string>>(new Set());

// Round trip: 'forward' while heading to turnaround, 'return' after.
// turnaroundStopIndex is the virtual stop index at the turnaround (null for one-way trips).
export const journeyPhase = signal<'forward' | 'return'>('forward');
export const turnaroundStopIndex = signal<number | null>(null);
const pendingStationPings = new Set<number>();

// Populated at boot by App.tsx so the Archive tab can badge itself. We allow
// multiple in-flight sessions per user — any incomplete session counts. The
// full active list is visible in the Archive history (in-progress rows).
export const hasActiveSession = signal<boolean>(false);

// Signals to World.ts that the train should start at the checkpoint stop's
// path position, not at stop 0. Cleared after the path is built.
export const resumeCheckpointStopIndex = signal<number | null>(null);

export const pendingDoorOpen = signal<boolean>(false);

export async function refreshActiveSession(): Promise<void> {
    hasActiveSession.value = (await fetchActiveJourneySession()) !== null;
}

export async function discardSession(sessionId: string): Promise<boolean> {
    return await apiDiscardActiveSession(sessionId);
}

function pingStationArrival(stationIndex: number): void {
    const sessionId = journeySessionId.value;
    if (!sessionId || pendingStationPings.has(stationIndex)) return;

    pendingStationPings.add(stationIndex);

    reportStationArrival(sessionId, stationIndex).then(result => {
        pendingStationPings.delete(stationIndex);
        if (result) {
            stationArrivalResults.value = [...stationArrivalResults.value, result];
            if (result.is_complete) {
                journeyCompleted.value = true;
                // After completion, re-probe — the user may still have other in-flight trips.
                refreshActiveSession();
            }
        }
    });
}

const _stopZone = { start: 0, end: 0 };
function getStopZone(stopDistanceKm: number): { start: number; end: number } {
    const trainLengthKm = trainLength.value / 1000;
    const leniencyKm = configs.value.stationStopLeniencyM / 1000;
    const halfZoneLengthKm = (trainLengthKm + leniencyKm) / 2;

    _stopZone.start = Math.max(0, stopDistanceKm - halfZoneLengthKm);
    _stopZone.end = stopDistanceKm + halfZoneLengthKm;
    return _stopZone;
}

export function updateStopStatuses(): void {
    const distances = stopDistances.value;
    const stopsArr = stops.value;
    const elapsed = elapsedMinutes.value;
    const trainCenterKm = trainDistanceTraveled.value / 1000;
    const velocity = trainVelocityKmh.value;
    const isStopped = Math.abs(velocity) < 1;
    const turnaroundIdx = turnaroundStopIndex.value;
    const phase = journeyPhase.value;

    if (distances.length === 0 || stopsArr.length === 0) return;

    if (stopStatuses.value.length !== stopsArr.length) {
        stopStatuses.value = stopsArr.map(() => ({
            arrived: false,
            departed: false,
            actualArrivalTime: null,
            actualDepartureTime: null,
            arrivalDelta: null,
            departureDelta: null,
        }));
    }

    let newStatuses: typeof stopStatuses.value | null = null;
    let needsDoorPrompt = false;

    // Phase-gated index range. For one-way trips (turnaroundIdx === null) this spans all stops.
    // Forward phase: 0 .. turnaroundIdx (or last stop if one-way).
    // Return phase: turnaroundIdx .. lastStop — the turnaround is kept in range so its
    // `departed` flag gets set once the train reverses past its zone.
    const startIdx = phase === 'return' && turnaroundIdx !== null ? turnaroundIdx : 0;
    const endIdx = phase === 'forward' && turnaroundIdx !== null ? turnaroundIdx : stopsArr.length - 1;

    for (let i = startIdx; i <= endIdx; i++) {
        const stopDistanceKm = distances[i];
        const stopZone = getStopZone(stopDistanceKm);

        const isInStopZone = trainCenterKm >= stopZone.start && trainCenterKm <= stopZone.end;
        // Forward leg: past means train moved beyond end-of-zone. Return leg: past means train moved below start-of-zone.
        const isPastStopZone = phase === 'return'
            ? trainCenterKm < stopZone.start
            : trainCenterKm > stopZone.end;

        const current = (newStatuses ?? stopStatuses.value)[i];

        if (!current.arrived && isInStopZone && isStopped && !trainDoorsOpen.value) {
            needsDoorPrompt = true;
        }

        if (!current.arrived && isInStopZone && isStopped && trainDoorsOpen.value) {
            if (!newStatuses) newStatuses = [...stopStatuses.value];
            newStatuses[i] = {
                ...current,
                arrived: true,
                actualArrivalTime: elapsed,
                arrivalDelta: Math.round(elapsed - stopsArr[i].arrivalTime),
            };

            if (i > 0) {
                pingStationArrival(i);
            }

            // Flip phase when the turnaround stop is reached.
            if (turnaroundIdx !== null && i === turnaroundIdx && phase === 'forward') {
                journeyPhase.value = 'return';
            }
        }

        if (current.arrived && !current.departed && isPastStopZone) {
            if (!newStatuses) newStatuses = [...stopStatuses.value];
            newStatuses[i] = {
                ...current,
                departed: true,
                actualDepartureTime: elapsed,
                departureDelta: Math.round(elapsed - stopsArr[i].departureTime),
            };
        }
    }

    if (newStatuses) {
        stopStatuses.value = newStatuses;
    }
    if (pendingDoorOpen.value !== needsDoorPrompt) {
        pendingDoorOpen.value = needsDoorPrompt;
    }
}

export function getStopZoneForStop(stopIndex: number): { startKm: number; endKm: number } | null {
    const distances = stopDistances.value;
    if (stopIndex >= distances.length) return null;

    const zone = getStopZone(distances[stopIndex]);
    return { startKm: zone.start, endKm: zone.end };
}

export const stops = computed<RouteStop[]>(() => {
    return routeData.value?.properties?.stops ?? [];
});

export const totalStops = computed(() => stops.value.length);
export const elapsedMinutes = signal(0);

export function updateElapsedTime(): void {
    if (!journeyStartTime.value) {
        elapsedMinutes.value = 0;
        return;
    }
    elapsedMinutes.value += (scaledDeltaTime.value / 60);
}

function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function computeSegmentDistances(route: RouteData): number[] {
    const routePoints = route.geometry?.route;
    const stopIndices = route.geometry?.stop_indices;

    if (!routePoints || !stopIndices || stopIndices.length < 2) {
        return [];
    }

    const segments: number[] = [];
    for (let i = 1; i < stopIndices.length; i++) {
        // Direction-agnostic for round trips: return-leg segments have startIdx > endIdx
        const startIdx = Math.min(stopIndices[i - 1], stopIndices[i]);
        const endIdx = Math.max(stopIndices[i - 1], stopIndices[i]);
        let segmentDistance = 0;
        for (let j = startIdx; j < endIdx; j++) {
            const [lon1, lat1] = routePoints[j];
            const [lon2, lat2] = routePoints[j + 1];
            segmentDistance += haversineDistanceKm(lat1, lon1, lat2, lon2);
        }
        segments.push(segmentDistance);
    }
    return segments;
}

/** The active 3D path — set by World.ts after path construction. */
export const trainPath = signal<Path | null>(null);

/** Cumulative stop distances in km, derived from the 3D Path arc-length.
 *  Reactively updates when either routeData or trainPath changes.
 *  Uses actual path distance rather than haversine, so distances
 *  correctly reflect world_offset movements (e.g. station Z adjustments). */
// Cumulative distances (meters) at each route point, for mapping train position → metadata index.
const routeCumulativeMeters = computed<number[] | null>(() => {
    const route = routeData.value;
    const points = route?.geometry?.route;
    if (!points || points.length < 2) return null;
    const cum: number[] = new Array(points.length);
    cum[0] = 0;
    for (let i = 1; i < points.length; i++) {
        const [lon1, lat1] = points[i - 1];
        const [lon2, lat2] = points[i];
        cum[i] = cum[i - 1] + haversineDistanceKm(lat1, lon1, lat2, lon2) * 1000;
    }
    return cum;
});

export const trackMaxSpeedKmh = computed<number | null>(() => {
    const route = routeData.value;
    const cum = routeCumulativeMeters.value;
    const meta = route?.geometry?.metadata;
    if (!route || !cum || !meta || cum.length < 2) return null;

    const trainMeters = trainDistanceTraveled.value;
    // Binary search for the route point at/before the train's current position.
    let lo = 0;
    let hi = cum.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >>> 1;
        if (cum[mid] <= trainMeters) lo = mid;
        else hi = mid - 1;
    }
    return meta[lo]?.max_speed ?? null;
});

export const stopDistances = computed<number[]>(() => {
    const path = trainPath.value;
    const route = routeData.value;
    if (!path || !route) return [];

    const stopIndices = route.geometry.stop_indices;
    if (!stopIndices?.length) return [];

    return stopIndices.map(idx => path.getDistanceAtPointIndex(idx) / 1000);
});

export function getExpectedPositionKm(elapsed: number): number {
    const stopsArr = stops.value;
    const distances = stopDistances.value;

    if (stopsArr.length === 0 || distances.length === 0) return 0;

    if (elapsed <= stopsArr[0].departureTime) {
        return distances[0];
    }

    const lastStop = stopsArr[stopsArr.length - 1];
    if (elapsed >= lastStop.arrivalTime) {
        return distances[distances.length - 1];
    }

    for (let i = 0; i < stopsArr.length - 1; i++) {
        const fromStop = stopsArr[i];
        const toStop = stopsArr[i + 1];

        if (elapsed >= fromStop.arrivalTime && elapsed <= fromStop.departureTime) {
            return distances[i];
        }

        if (elapsed > fromStop.departureTime && elapsed < toStop.arrivalTime) {
            const segmentDuration = toStop.arrivalTime - fromStop.departureTime;
            const timeIntoSegment = elapsed - fromStop.departureTime;
            const progress = segmentDuration > 0 ? timeIntoSegment / segmentDuration : 0;

            const fromDistance = distances[i];
            const toDistance = distances[i + 1];
            return fromDistance + (toDistance - fromDistance) * progress;
        }
    }

    return distances[distances.length - 1];
}

export function getRunningDelayMinutes(): number {
    const stopsArr = stops.value;
    const distances = stopDistances.value;
    const statuses = stopStatuses.value;
    const elapsed = elapsedMinutes.value;
    const actualPositionKm = trainDistanceTraveled.value / 1000;

    if (stopsArr.length < 2 || distances.length < 2) return 0;

    let nextUnservicedIdx = -1;
    for (let i = 0; i < stopsArr.length; i++) {
        const status = statuses[i];
        if (!status || !status.arrived) {
            nextUnservicedIdx = i;
            break;
        }
    }

    if (nextUnservicedIdx === -1) return 0;

    const targetStopDistanceKm = distances[nextUnservicedIdx];
    const distanceToTargetKm = targetStopDistanceKm - actualPositionKm;
    const absDistanceToTargetKm = Math.abs(distanceToTargetKm);

    const expectedPositionKm = getExpectedPositionKm(elapsed);
    const segmentIdx = Math.max(0, nextUnservicedIdx - 1);
    const fromStop = stopsArr[segmentIdx];
    const toStop = stopsArr[Math.min(segmentIdx + 1, stopsArr.length - 1)];
    const segmentDistanceKm = distances[segmentIdx + 1] - distances[segmentIdx];
    const segmentTimeMinutes = toStop.arrivalTime - fromStop.departureTime;

    if (segmentTimeMinutes <= 0 || segmentDistanceKm <= 0) return 0;

    const avgSpeedKmPerMin = segmentDistanceKm / segmentTimeMinutes;
    const scheduledArrival = stopsArr[nextUnservicedIdx].arrivalTime;

    const timeBasedDelay = elapsed - scheduledArrival;
    let positionBasedDelay: number;
    const timeToReachStopMinutes = absDistanceToTargetKm / avgSpeedKmPerMin;
    const expectedArrivalTime = elapsed + timeToReachStopMinutes;
    positionBasedDelay = expectedArrivalTime - scheduledArrival;

    let delayMinutes: number;
    if (timeBasedDelay > 0) {
        delayMinutes = Math.max(timeBasedDelay, positionBasedDelay);
    } else {
        const isApproachingNormally = distanceToTargetKm > 0 && actualPositionKm <= targetStopDistanceKm;
        if (isApproachingNormally) {
            const positionDeltaKm = expectedPositionKm - actualPositionKm;
            delayMinutes = positionDeltaKm / avgSpeedKmPerMin;
        } else {
            delayMinutes = positionBasedDelay;
        }
    }

    return delayMinutes >= 0 ? Math.floor(delayMinutes) : Math.ceil(delayMinutes);
}

export const currentStopIndex = computed(() => {
    const stopsArr = stops.value;
    const elapsed = elapsedMinutes.value;

    if (stopsArr.length === 0) return 0;

    for (let i = stopsArr.length - 1; i >= 0; i--) {
        if (elapsed >= stopsArr[i].arrivalTime) {
            return i;
        }
    }
    return 0;
});

export const isAtStation = computed(() => {
    const idx = currentStopIndex.value;
    const stopsArr = stops.value;
    const elapsed = elapsedMinutes.value;

    if (idx >= stopsArr.length) return false;

    const stop = stopsArr[idx];
    return elapsed >= stop.arrivalTime && elapsed < stop.departureTime;
});

export const nextStopIndex = computed(() => {
    const idx = currentStopIndex.value;
    const stopsArr = stops.value;

    if (isAtStation.value) {
        return idx;
    }

    return Math.min(idx + 1, stopsArr.length - 1);
});

export const timeToNextEvent = computed(() => {
    const stopsArr = stops.value;
    const elapsed = elapsedMinutes.value;
    const idx = currentStopIndex.value;

    if (stopsArr.length === 0) return 0;

    if (isAtStation.value) {
        return Math.max(0, stopsArr[idx].departureTime - elapsed);
    }

    const nextIdx = Math.min(idx + 1, stopsArr.length - 1);
    return Math.max(0, stopsArr[nextIdx].arrivalTime - elapsed);
});

export function distanceToStop(stopIndex: number): number {
    const distances = stopDistances.value;

    if (distances.length === 0 || stopIndex >= distances.length) {
        return 0;
    }

    const trainDistance = trainDistanceTraveled.value / 1000;
    const stopDistance = distances[stopIndex];
    const turnaroundIdx = turnaroundStopIndex.value;
    const phase = journeyPhase.value;

    // One-way journey: simple linear distance along the forward path.
    if (turnaroundIdx === null) {
        return stopDistance - trainDistance;
    }

    // Round trip: distance must be measured along the route, not as physical distance.
    const turnaroundKm = distances[turnaroundIdx];

    if (phase === 'forward') {
        if (stopIndex <= turnaroundIdx) {
            return stopDistance - trainDistance;
        }
        // Target is a return-leg stop: go to turnaround first, then back to target.
        return (turnaroundKm - trainDistance) + (turnaroundKm - stopDistance);
    }

    // Return phase: already past turnaround, train approaches return stops from higher km.
    if (stopIndex <= turnaroundIdx) {
        return 0;
    }
    return trainDistance - stopDistance;
}

export function getJourneyProgress(): number {
    const totalLength = trainPathTotalLength.value;
    if (totalLength === 0) return 0;

    const raw = trainDistanceTraveled.value / totalLength;
    const turnaroundIdx = turnaroundStopIndex.value;
    if (turnaroundIdx === null) {
        return Math.min(1, raw);
    }

    // Round trip: forward half 0→0.5, return half 0.5→1.0 as distance decreases.
    return journeyPhase.value === 'forward'
        ? Math.min(0.5, raw * 0.5)
        : Math.min(1, 0.5 + (1 - raw) * 0.5);
}

export function getProgressBetweenStops(fromStopIndex: number, toStopIndex: number): number {
    const distances = stopDistances.value;

    if (distances.length < 2 || fromStopIndex >= distances.length || toStopIndex >= distances.length) {
        return 0;
    }

    const trainDistance = trainDistanceTraveled.value / 1000;
    const fromDistance = distances[fromStopIndex];
    const toDistance = distances[toStopIndex];
    // Round trip return segments have fromDistance > toDistance; use absolute length.
    const segmentLength = Math.abs(toDistance - fromDistance);

    if (segmentLength <= 0) return 1;

    const distanceIntoSegment = Math.abs(trainDistance - fromDistance);
    return Math.max(0, Math.min(1, distanceIntoSegment / segmentLength));
}

export interface UserRouteJourneyOptions {
    id: string;
    stationCoords: [number, number][];
}

export function startJourney(
    route: RouteData,
    customStartTime?: number,
    isRoundTrip?: boolean,
    userRoute?: UserRouteJourneyOptions,
): void {
    routeData.value = route;
    journeyStartTime.value = customStartTime ?? Date.now();
    currentRouteIndex.value = 0;
    elapsedMinutes.value = 0;
    journeyCompleted.value = false;
    stationArrivalResults.value = [];
    journeySessionId.value = null;
    alreadyVisitedStations.value = new Set();
    pendingStationPings.clear();

    const stopsArr = route.properties?.stops ?? [];

    // Round trip: turnaround is the midpoint of the 7-stop virtual list (index 3 for [A,B,C,D,C,B,A]).
    // One-way: null disables return-phase gating.
    journeyPhase.value = 'forward';
    turnaroundStopIndex.value = (isRoundTrip && stopsArr.length >= 3)
        ? Math.floor((stopsArr.length - 1) / 2)
        : null;

    if (stopsArr.length > 0) {
        stopStatuses.value = stopsArr.map((_, idx) => ({
            arrived: idx === 0,
            departed: false,
            actualArrivalTime: idx === 0 ? 0 : null,
            actualDepartureTime: null,
            arrivalDelta: idx === 0 ? 0 : null,
            departureDelta: null,
        }));
    }

    const stationCodes = stopsArr.map(s => s.code).filter(Boolean);
    const stationTracks = stopsArr.map(s => s.track || null);
    if (stationCodes.length >= 2) {
        const segmentDistances = computeSegmentDistances(route).map(d => Math.round(d * 100) / 100);
        const sessionOptions = userRoute ? {
            isUserRoute: true,
            userRouteId: userRoute.id,
            stationCoords: userRoute.stationCoords,
        } : undefined;
        apiStartJourney(stationCodes, country.value, segmentDistances, stationTracks, isRoundTrip, sessionOptions).then(result => {
            if (result.kind === 'ok') {
                journeySessionId.value = result.session_id;
                alreadyVisitedStations.value = new Set(result.already_visited);
                hasActiveSession.value = true;
            }
        });
    }
}

// Compact Transit HUD fallback for user routes whose saved `code` is still an
// OSM node id (pre-dates the railway:ref plumbing). New saves already store the
// proper short code, so shortCodeFromName() only runs for legacy rows.
const STATION_NAME_NOISE = /\b(hauptbahnhof|hbf|bahnhof|bhf|station|centraal|central)\b/gi;
const SHORT_CODE_PATTERN = /^[A-Z]{1,5}$/;

function shortCodeFromName(name: string): string {
    const cleaned = name.replace(STATION_NAME_NOISE, '').replace(/[()]/g, ' ').trim();
    const letters = cleaned.replace(/[^A-Za-zÀ-ÿ]/g, '');
    return letters.slice(0, 3).toUpperCase() || 'STA';
}

// Derives station_coords from geometry since user-route stops aren't in `stations`.
export function startUserRouteJourney(route: RouteData, userRouteId: string): void {
    const stopsArr = route.properties?.stops ?? [];
    const stopIndices = route.geometry.stop_indices ?? [];

    const stationCoords: [number, number][] = stopsArr.map((_, i) => {
        const ptIdx = stopIndices[i] ?? 0;
        const pt = route.geometry.route[ptIdx];
        return [pt[0], pt[1]];
    });

    const displayCodes = stopsArr.map(s =>
        SHORT_CODE_PATTERN.test(s.code) ? s.code : shortCodeFromName(s.station)
    );

    const timedStops = calculateStopTimes(
        stopsArr.map(s => s.station),
        displayCodes,
        stopsArr.map(s => s.track),
        route.geometry,
    );

    const timedRoute: RouteData = {
        geometry: route.geometry,
        properties: { ...route.properties, stops: timedStops },
    };

    startJourney(timedRoute, undefined, false, { id: userRouteId, stationCoords });
}

// Rebuilds a RouteData from an active session and hydrates all journey signals
// to the checkpoint state so the game resumes cleanly at the last visited stop.
// Returns false if the route can no longer be loaded (e.g. user_route deleted) —
// caller should offer a "discard and start over" option.
export async function resumeJourney(
    session: ActiveSession,
    stationNameByCode?: Map<string, string>,
): Promise<boolean> {
    try {
        let resumedRoute: RouteData;

        if (session.is_user_route) {
            if (!session.user_route_id) return false;
            const route = await fetchSharedUserRoute(session.user_route_id).catch(() => null);
            if (!route) return false;

            const displayCodes = route.stops.map(s =>
                SHORT_CODE_PATTERN.test(s.code) ? s.code : shortCodeFromName(s.station)
            );
            const timedStops = calculateStopTimes(
                route.stops.map(s => s.station),
                displayCodes,
                route.stops.map(s => s.track),
                route.geometry,
            );
            resumedRoute = { geometry: route.geometry, properties: { stops: timedStops } };
        } else {
            // Curated route: session.station_codes may be mirrored for round trips.
            // Refetch geometry for the forward leg only, then mirror stop_indices.
            const keep = session.is_round_trip && session.station_codes.length >= 3
                ? Math.ceil(session.station_codes.length / 2)
                : session.station_codes.length;

            const forwardStops: { code: string; track?: string }[] = [];
            for (let i = 0; i < keep; i++) {
                forwardStops.push({
                    code: session.station_codes[i],
                    track: session.station_tracks?.[i] || undefined,
                });
            }

            const journeyData = await fetchJourneyRoute(forwardStops);

            if (session.is_round_trip) {
                const forwardStopIndices = journeyData.geometry.stop_indices;
                const returnStopIndices = [...forwardStopIndices].slice(0, -1).reverse();
                journeyData.geometry.stop_indices = [...forwardStopIndices, ...returnStopIndices];
            }

            const stopNames = session.station_codes.map(code =>
                stationNameByCode?.get(code) ?? stationNameByCode?.get(code.toUpperCase()) ?? code
            );
            const timedStops = calculateStopTimes(
                stopNames,
                session.station_codes,
                (session.station_tracks ?? session.station_codes.map(() => null)) as (string | null)[],
                journeyData.geometry,
            );
            resumedRoute = { geometry: journeyData.geometry, properties: { stops: timedStops, startTime: Date.now() } };
        }

        const stopsArr = resumedRoute.properties.stops;
        const lastIdx = Math.min(session.last_station_index, stopsArr.length - 1);

        // Reset first, then apply resume overrides. Order matters: resetTrain()
        // zeros trainDistanceTraveled, but World.ts will pick up the checkpoint
        // signal when it builds the path and place the train at the right spot.
        resetJourney();

        routeData.value = resumedRoute;
        journeyStartTime.value = Date.now();
        journeySessionId.value = session.id;
        journeyCompleted.value = false;
        currentRouteIndex.value = 0;

        elapsedMinutes.value = stopsArr[lastIdx]?.arrivalTime ?? 0;

        stopStatuses.value = stopsArr.map((stop, i) => {
            if (i < lastIdx) {
                return {
                    arrived: true,
                    departed: true,
                    actualArrivalTime: stop.arrivalTime,
                    actualDepartureTime: stop.departureTime,
                    arrivalDelta: 0,
                    departureDelta: 0,
                };
            }
            if (i === lastIdx) {
                return {
                    arrived: true,
                    departed: false,
                    actualArrivalTime: stop.arrivalTime,
                    actualDepartureTime: null,
                    arrivalDelta: 0,
                    departureDelta: null,
                };
            }
            return {
                arrived: false,
                departed: false,
                actualArrivalTime: null,
                actualDepartureTime: null,
                arrivalDelta: null,
                departureDelta: null,
            };
        });

        const turnaroundIdx = (session.is_round_trip && stopsArr.length >= 3)
            ? Math.floor((stopsArr.length - 1) / 2)
            : null;
        turnaroundStopIndex.value = turnaroundIdx;
        journeyPhase.value = (turnaroundIdx !== null && lastIdx >= turnaroundIdx) ? 'return' : 'forward';

        // Pre-seed so no stale "already visited" ping fires for 0..lastIdx.
        for (let i = 0; i <= lastIdx; i++) pendingStationPings.add(i);

        resumeCheckpointStopIndex.value = lastIdx;

        return true;
    } catch (err) {
        console.error('Failed to resume journey:', err);
        return false;
    }
}

export function getScheduleBasedStartTime(initialDwellMinutes: number): number {
    const now = new Date();
    const minutes = now.getMinutes();
    const roundedMinutes = Math.ceil((minutes + 1) / 5) * 5;
    const departureTime = new Date(now);
    departureTime.setMinutes(roundedMinutes, 0, 0);

    return departureTime.getTime() - (initialDwellMinutes * 60 * 1000);
}

export function resetJourney(): void {
    routeData.value = null;
    trainPath.value = null;
    journeyStartTime.value = null;
    currentRouteIndex.value = 0;
    elapsedMinutes.value = 0;
    stopStatuses.value = [];
    journeySessionId.value = null;
    journeyCompleted.value = false;
    stationArrivalResults.value = [];
    alreadyVisitedStations.value = new Set();
    pendingStationPings.clear();
    journeyPhase.value = 'forward';
    turnaroundStopIndex.value = null;
    resumeCheckpointStopIndex.value = null;
    resetTrain();
}

export function formatRelativeTime(minutes: number): string {
    if (minutes <= 0) return "now";

    const totalSeconds = Math.round(minutes * 60);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;

    if (mins === 0) {
        return `${secs}s`;
    }
    if (secs === 0) {
        return `${mins}m`;
    }
    return `${mins}m ${secs}s`;
}

const KM_TO_MILE = 0.62137;
const M_TO_FT = 3.28084;

export function formatDistance(km: number): string {
    const sign = km < 0 ? '-' : '';
    const absKm = Math.abs(km);
    if (configs.value.unitSystem === 'imperial') {
        const miles = absKm * KM_TO_MILE;
        if (miles < 0.1) {
            return `${sign}${Math.round(absKm * 1000 * M_TO_FT)} ft`;
        }
        return `${sign}${miles.toFixed(1)} mi`;
    }
    if (absKm < 1) {
        return `${sign}${Math.round(absKm * 1000)} m`;
    }
    return `${sign}${absKm.toFixed(1)} km`;
}

export function formatDistanceKm(km: number): string {
    const sign = km < 0 ? '-' : '';
    const absKm = Math.abs(km);
    if (configs.value.unitSystem === 'imperial') {
        return `${sign}${(absKm * KM_TO_MILE).toFixed(1)} mi`;
    }
    return `${sign}${absKm.toFixed(1)} km`;
}

export function formatScheduleTime(minutes: number): string {
    const mins = Math.round(minutes);
    if (mins === 0) return "0m";
    return `+${mins}m`;
}

export function getCurrentGameTime(): Date | null {
    const startTime = journeyStartTime.value;
    if (!startTime) return null;
    return new Date(startTime + elapsedMinutes.value * 60 * 1000);
}

export function getScheduledTime(minutesFromStart: number): Date | null {
    const startTime = journeyStartTime.value;
    if (!startTime) return null;
    return new Date(startTime + minutesFromStart * 60 * 1000);
}

export function formatClockTime(date: Date | null, includeSeconds = false): string {
    if (!date) return includeSeconds ? '--:--:--' : '--:--';
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    if (includeSeconds) {
        const seconds = date.getSeconds().toString().padStart(2, '0');
        return `${hours}:${minutes}:${seconds}`;
    }
    return `${hours}:${minutes}`;
}

export function getPredictedTime(scheduledMinutesFromStart: number, delayMinutes: number): Date | null {
    const startTime = journeyStartTime.value;
    if (!startTime) return null;
    return new Date(startTime + (scheduledMinutesFromStart + delayMinutes) * 60 * 1000);
}

export function formatTimeDelta(delta: number | null): { text: string; status: 'early' | 'ontime' | 'late' } {
    if (delta === null) return { text: '', status: 'ontime' };

    if (delta === 0) {
        return { text: '(0)', status: 'ontime' };
    } else if (delta < 0) {
        return { text: `(${delta})`, status: 'early' };
    } else {
        return { text: `(+${delta})`, status: 'late' };
    }
}

export function getTimeUntilDeparture(stopIndex: number): number {
    const stopsArr = stops.value;
    const elapsed = elapsedMinutes.value;

    if (stopIndex >= stopsArr.length) return 0;

    return stopsArr[stopIndex].departureTime - elapsed;
}

export function getTimeUntilArrival(stopIndex: number): number {
    const stopsArr = stops.value;
    const elapsed = elapsedMinutes.value;

    if (stopIndex >= stopsArr.length) return 0;

    return stopsArr[stopIndex].arrivalTime - elapsed;
}
