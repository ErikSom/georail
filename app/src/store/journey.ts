import { signal, computed } from "@preact/signals";
import type { RouteData, RouteStop } from "../lib/api/navigation";
import { trainDistanceTraveled, trainPathTotalLength, trainVelocityKmh, trainLength } from "./train";
import { configs, scaledDeltaTime } from "./globals";
import { startJourneySession as apiStartJourney, reportStationArrival, type StationArrivalResponse } from "../lib/api/journey";

/**
 * Journey state for tracking route progress during gameplay
 */

// Route data with stops and timing information
export const routeData = signal<RouteData | null>(null);

// Journey start timestamp (Date.now() when journey starts)
export const journeyStartTime = signal<number | null>(null);

// Current index in the route geometry (which point the train is at)
export const currentRouteIndex = signal(0);

/**
 * Stop status tracking for game scoring
 */
export interface StopStatus {
    arrived: boolean;           // Has the train arrived at this stop?
    departed: boolean;          // Has the train departed from this stop?
    actualArrivalTime: number | null;    // When did train actually arrive (minutes)
    actualDepartureTime: number | null;  // When did train actually depart (minutes)
    arrivalDelta: number | null;         // Difference from scheduled (negative = early, positive = late)
    departureDelta: number | null;       // Difference from scheduled (negative = early, positive = late)
}

// Track status for each stop
export const stopStatuses = signal<StopStatus[]>([]);

// Journey session tracking (server-side anti-cheat)
export const journeySessionId = signal<string | null>(null);
export const journeyCompleted = signal(false);
export const stationArrivalResults = signal<StationArrivalResponse[]>([]);

// Prevent duplicate pings for the same station
const pendingStationPings = new Set<number>();

/**
 * Report station arrival to server (fire-and-forget, non-blocking)
 */
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
            }
        }
    });
}

/**
 * Calculate the stop zone boundaries for a station
 * Stop zone is centered on the station position
 * Zone length = train length + leniency, extending half on each side
 * Train must be stopped within this zone to count as "arrived"
 */
function getStopZone(stopDistanceKm: number): { start: number; end: number } {
    const trainLengthKm = trainLength.value / 1000;
    const leniencyKm = configs.value.stationStopLeniencyM / 1000;
    const halfZoneLengthKm = (trainLengthKm + leniencyKm) / 2;

    return {
        start: Math.max(0, stopDistanceKm - halfZoneLengthKm),
        end: stopDistanceKm + halfZoneLengthKm,
    };
}

/**
 * Update stop statuses based on train position
 * Call this each frame to detect arrivals and departures
 *
 * Arrival: Train center is within stop zone AND train is stopped (velocity < 1 km/h)
 * Departure: Train center has passed the stop zone end
 */
export function updateStopStatuses(): void {
    const distances = stopDistances.value;
    const stopsArr = stops.value;
    const elapsed = elapsedMinutes.value;
    const trainCenterKm = trainDistanceTraveled.value / 1000; // Train center position in km
    const velocity = trainVelocityKmh.value;
    const isStopped = Math.abs(velocity) < 1;

    if (distances.length === 0 || stopsArr.length === 0) return;

    // Initialize statuses if needed
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

    const newStatuses = [...stopStatuses.value];
    let changed = false;

    for (let i = 0; i < stopsArr.length; i++) {
        const stopDistanceKm = distances[i];
        const stopZone = getStopZone(stopDistanceKm);

        const isInStopZone = trainCenterKm >= stopZone.start && trainCenterKm <= stopZone.end;
        const isPastStopZone = trainCenterKm > stopZone.end;

        // Check for arrival: in stop zone AND stopped
        if (!newStatuses[i].arrived && isInStopZone && isStopped) {
            newStatuses[i] = {
                ...newStatuses[i],
                arrived: true,
                actualArrivalTime: elapsed,
                arrivalDelta: Math.round(elapsed - stopsArr[i].arrivalTime),
            };
            changed = true;

            // Ping server for non-first stations (first is recorded at session start)
            if (i > 0) {
                pingStationArrival(i);
            }
        }

        // Check for departure: must have arrived, and train front has left the stop zone
        if (newStatuses[i].arrived && !newStatuses[i].departed && isPastStopZone) {
            newStatuses[i] = {
                ...newStatuses[i],
                departed: true,
                actualDepartureTime: elapsed,
                departureDelta: Math.round(elapsed - stopsArr[i].departureTime),
            };
            changed = true;
        }
    }

    if (changed) {
        stopStatuses.value = newStatuses;
    }
}

/**
 * Get the stop zone for a specific stop (for visualization)
 */
export function getStopZoneForStop(stopIndex: number): { startKm: number; endKm: number } | null {
    const distances = stopDistances.value;
    if (stopIndex >= distances.length) return null;

    const zone = getStopZone(distances[stopIndex]);
    return { startKm: zone.start, endKm: zone.end };
}

// Computed: stops array from route data
export const stops = computed<RouteStop[]>(() => {
    return routeData.value?.properties?.stops ?? [];
});

// Computed: total number of stops
export const totalStops = computed(() => stops.value.length);

// Elapsed time signal - must be updated externally on each tick
export const elapsedMinutes = signal(0);

/**
 * Update elapsed time - call this on each game tick
 * Accumulates time based on scaledDeltaTime to respect timeScale
 */
export function updateElapsedTime(): void {
    if (!journeyStartTime.value) {
        elapsedMinutes.value = 0;
        return;
    }
    // Accumulate scaled time (convert seconds to minutes)
    elapsedMinutes.value += (scaledDeltaTime.value / 60);
}

/**
 * Calculate distance between two lat/lon points in kilometers using Haversine formula
 */
function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Earth radius in kilometers
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Calculate cumulative distances from start to each stop
 */
export const stopDistances = computed<number[]>(() => {
    const route = routeData.value?.geometry?.route;
    const stopIndices = routeData.value?.geometry?.stop_indices;

    if (!route || !stopIndices || stopIndices.length === 0) {
        return [];
    }

    const distances: number[] = [0]; // First stop is at 0
    let cumulative = 0;

    for (let i = 1; i < stopIndices.length; i++) {
        const startIdx = stopIndices[i - 1];
        const endIdx = stopIndices[i];

        for (let j = startIdx; j < endIdx; j++) {
            const [lon1, lat1] = route[j];
            const [lon2, lat2] = route[j + 1];
            cumulative += haversineDistanceKm(lat1, lon1, lat2, lon2);
        }
        distances.push(cumulative);
    }

    return distances;
});

/**
 * Get expected position (in km) based on elapsed time according to the schedule.
 * Interpolates between stops based on departure/arrival times.
 */
export function getExpectedPositionKm(elapsed: number): number {
    const stopsArr = stops.value;
    const distances = stopDistances.value;

    if (stopsArr.length === 0 || distances.length === 0) return 0;

    // Before first departure - at first station
    if (elapsed <= stopsArr[0].departureTime) {
        return 0;
    }

    // After last arrival - at last station
    const lastStop = stopsArr[stopsArr.length - 1];
    if (elapsed >= lastStop.arrivalTime) {
        return distances[distances.length - 1];
    }

    // Find which segment we're in based on schedule
    for (let i = 0; i < stopsArr.length - 1; i++) {
        const fromStop = stopsArr[i];
        const toStop = stopsArr[i + 1];

        // If we're at a station (between arrival and departure)
        if (elapsed >= fromStop.arrivalTime && elapsed <= fromStop.departureTime) {
            return distances[i];
        }

        // If we're traveling between stops
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

/**
 * Calculate the running delay in minutes based on position.
 * Positive = behind schedule (late), Negative = ahead of schedule (early)
 * This is stable and doesn't fluctuate with speed changes.
 *
 * Handles overshoot: if the train has passed a stop without properly arriving,
 * the delay accounts for the need to return to that stop.
 */
export function getRunningDelayMinutes(): number {
    const stopsArr = stops.value;
    const distances = stopDistances.value;
    const statuses = stopStatuses.value;
    const elapsed = elapsedMinutes.value;
    const actualPositionKm = trainDistanceTraveled.value / 1000;

    if (stopsArr.length < 2 || distances.length < 2) return 0;

    // Find the next stop that hasn't been properly serviced (arrived = false)
    let nextUnservicedIdx = -1;
    for (let i = 0; i < stopsArr.length; i++) {
        const status = statuses[i];
        if (!status || !status.arrived) {
            nextUnservicedIdx = i;
            break;
        }
    }

    // If all stops have been serviced, no delay to calculate
    if (nextUnservicedIdx === -1) return 0;

    const targetStopDistanceKm = distances[nextUnservicedIdx];
    const distanceToTargetKm = targetStopDistanceKm - actualPositionKm;
    const absDistanceToTargetKm = Math.abs(distanceToTargetKm);

    // Calculate expected position based on schedule
    const expectedPositionKm = getExpectedPositionKm(elapsed);

    // Find the segment we should use for speed calculation
    // Use the segment leading TO the next unserviced stop
    const segmentIdx = Math.max(0, nextUnservicedIdx - 1);
    const fromStop = stopsArr[segmentIdx];
    const toStop = stopsArr[Math.min(segmentIdx + 1, stopsArr.length - 1)];
    const segmentDistanceKm = distances[segmentIdx + 1] - distances[segmentIdx];
    const segmentTimeMinutes = toStop.arrivalTime - fromStop.departureTime;

    // Avoid division by zero
    if (segmentTimeMinutes <= 0 || segmentDistanceKm <= 0) return 0;

    const avgSpeedKmPerMin = segmentDistanceKm / segmentTimeMinutes;
    const scheduledArrival = stopsArr[nextUnservicedIdx].arrivalTime;

    // Time-based minimum delay: if we're past scheduled arrival, we're at least this late
    // This handles cases where the train is oscillating around a stop
    const timeBasedDelay = elapsed - scheduledArrival;

    // Position-based delay calculation
    let positionBasedDelay: number;

    // Calculate time needed to reach the stop from current position
    const timeToReachStopMinutes = absDistanceToTargetKm / avgSpeedKmPerMin;
    const expectedArrivalTime = elapsed + timeToReachStopMinutes;
    positionBasedDelay = expectedArrivalTime - scheduledArrival;

    // If we're past the scheduled arrival time, use the worse of the two delays
    // This prevents weird negative delays when oscillating around a stop
    let delayMinutes: number;
    if (timeBasedDelay > 0) {
        // We're past scheduled arrival - take the worse delay
        delayMinutes = Math.max(timeBasedDelay, positionBasedDelay);
    } else {
        // We're before scheduled arrival - use position-based calculation
        // but only allow negative (early) if we're actually approaching the stop normally
        const isApproachingNormally = distanceToTargetKm > 0 && actualPositionKm <= targetStopDistanceKm;
        if (isApproachingNormally) {
            // Normal approach - can show early or late based on position
            const positionDeltaKm = expectedPositionKm - actualPositionKm;
            delayMinutes = positionDeltaKm / avgSpeedKmPerMin;
        } else {
            // Overshot or reversed - use time to reach as delay estimate
            delayMinutes = positionBasedDelay;
        }
    }

    // Use floor for positive (late), ceil for negative (early) to be conservative
    // This way +50s shows as 0, +61s shows as +1, -50s shows as 0, -61s shows as -1
    return delayMinutes >= 0 ? Math.floor(delayMinutes) : Math.ceil(delayMinutes);
}

/**
 * Find current stop index based on elapsed time
 * Returns the index of the stop we're currently at or traveling from
 */
export const currentStopIndex = computed(() => {
    const stopsArr = stops.value;
    const elapsed = elapsedMinutes.value;

    if (stopsArr.length === 0) return 0;

    // Find which stop we're at or past
    for (let i = stopsArr.length - 1; i >= 0; i--) {
        if (elapsed >= stopsArr[i].arrivalTime) {
            return i;
        }
    }
    return 0;
});

/**
 * Check if we're currently stopped at a station (between arrival and departure)
 */
export const isAtStation = computed(() => {
    const idx = currentStopIndex.value;
    const stopsArr = stops.value;
    const elapsed = elapsedMinutes.value;

    if (idx >= stopsArr.length) return false;

    const stop = stopsArr[idx];
    return elapsed >= stop.arrivalTime && elapsed < stop.departureTime;
});

/**
 * Get the next stop index (or current if at final destination)
 */
export const nextStopIndex = computed(() => {
    const idx = currentStopIndex.value;
    const stopsArr = stops.value;

    if (isAtStation.value) {
        // If at a station, next is the same station (waiting to depart)
        return idx;
    }

    // If traveling, next is idx + 1 (unless at last stop)
    return Math.min(idx + 1, stopsArr.length - 1);
});

/**
 * Get time remaining until next event (arrival or departure)
 */
export const timeToNextEvent = computed(() => {
    const stopsArr = stops.value;
    const elapsed = elapsedMinutes.value;
    const idx = currentStopIndex.value;

    if (stopsArr.length === 0) return 0;

    if (isAtStation.value) {
        // Waiting at station - time until departure
        return Math.max(0, stopsArr[idx].departureTime - elapsed);
    }

    // Traveling - time until next arrival
    const nextIdx = Math.min(idx + 1, stopsArr.length - 1);
    return Math.max(0, stopsArr[nextIdx].arrivalTime - elapsed);
});

/**
 * Calculate distance from current train position to a specific stop
 * Uses the train's distance traveled along the path
 * Returns negative values if train has passed the stop
 */
export function distanceToStop(stopIndex: number): number {
    const distances = stopDistances.value;

    if (distances.length === 0 || stopIndex >= distances.length) {
        return 0;
    }

    const trainDistance = trainDistanceTraveled.value / 1000; // Convert m to km
    const stopDistance = distances[stopIndex];

    // Return remaining distance (negative if past the stop)
    return stopDistance - trainDistance;
}

/**
 * Get the train's progress as a fraction (0-1) of the total journey
 */
export function getJourneyProgress(): number {
    const totalLength = trainPathTotalLength.value;
    if (totalLength === 0) return 0;
    return Math.min(1, trainDistanceTraveled.value / totalLength);
}

/**
 * Get the train's progress between two specific stops (0-1)
 */
export function getProgressBetweenStops(fromStopIndex: number, toStopIndex: number): number {
    const distances = stopDistances.value;

    if (distances.length < 2 || fromStopIndex >= distances.length || toStopIndex >= distances.length) {
        return 0;
    }

    const trainDistance = trainDistanceTraveled.value / 1000; // Convert m to km
    const fromDistance = distances[fromStopIndex];
    const toDistance = distances[toStopIndex];
    const segmentLength = toDistance - fromDistance;

    if (segmentLength <= 0) return 1;

    const distanceIntoSegment = trainDistance - fromDistance;
    return Math.max(0, Math.min(1, distanceIntoSegment / segmentLength));
}

/**
 * Start a new journey
 * @param route - The route data
 * @param customStartTime - Optional custom start time (Date timestamp). If not provided, uses Date.now()
 */
export function startJourney(route: RouteData, customStartTime?: number): void {
    routeData.value = route;
    journeyStartTime.value = customStartTime ?? Date.now();
    currentRouteIndex.value = 0;
    elapsedMinutes.value = 0;
    journeyCompleted.value = false;
    stationArrivalResults.value = [];
    journeySessionId.value = null;
    pendingStationPings.clear();

    // Initialize stop statuses and mark first stop as arrived
    // (we start at the first station, so it's already "arrived")
    const stopsArr = route.properties?.stops ?? [];
    if (stopsArr.length > 0) {
        stopStatuses.value = stopsArr.map((_, idx) => ({
            arrived: idx === 0, // First stop starts as arrived
            departed: false,
            actualArrivalTime: idx === 0 ? 0 : null,
            actualDepartureTime: null,
            arrivalDelta: idx === 0 ? 0 : null, // Arrived exactly on time at start
            departureDelta: null,
        }));
    }

    // Start server journey session (fire-and-forget)
    const stationCodes = stopsArr.map(s => s.code).filter(Boolean);
    if (stationCodes.length >= 2) {
        apiStartJourney(stationCodes).then(result => {
            if (result) {
                journeySessionId.value = result.session_id;
                // Track first station as newly unlocked if it was new
                if (result.first_station_new) {
                    stationArrivalResults.value = [{
                        valid: true,
                        km_added: 0,
                        total_km: 0,
                        new_station: true,
                        station_code: result.first_station_code,
                        is_complete: false,
                        total_stations_visited: 0,
                        journey_km: 0,
                    }];
                }
            }
        });
    }
}

/**
 * Calculate a schedule-based start time for regular routes.
 * Returns a timestamp where the first departure would be at a nice round time (e.g., XX:05, XX:10)
 * @param initialDwellMinutes - Minutes the train waits at the first station before departure
 */
export function getScheduleBasedStartTime(initialDwellMinutes: number): number {
    const now = new Date();
    // Round up to next 5-minute mark for the departure time
    const minutes = now.getMinutes();
    const roundedMinutes = Math.ceil((minutes + 1) / 5) * 5;
    const departureTime = new Date(now);
    departureTime.setMinutes(roundedMinutes, 0, 0);

    // Journey start time is departure time minus initial dwell
    return departureTime.getTime() - (initialDwellMinutes * 60 * 1000);
}

/**
 * Reset journey state
 */
export function resetJourney(): void {
    routeData.value = null;
    journeyStartTime.value = null;
    currentRouteIndex.value = 0;
    elapsedMinutes.value = 0;
    stopStatuses.value = [];
    journeySessionId.value = null;
    journeyCompleted.value = false;
    stationArrivalResults.value = [];
    pendingStationPings.clear();
}

/**
 * Format minutes to a human-readable relative time
 * e.g., 2.5 -> "2m 30s", 0.5 -> "30s"
 */
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

/**
 * Format distance in km or m based on value
 * Handles negative values (overshoot) with a minus sign
 */
export function formatDistance(km: number): string {
    const sign = km < 0 ? '-' : '';
    const absKm = Math.abs(km);
    if (absKm < 1) {
        return `${sign}${Math.round(absKm * 1000)} m`;
    }
    return `${sign}${absKm.toFixed(1)} km`;
}

/**
 * Format schedule time as "+Xm" from journey start
 */
export function formatScheduleTime(minutes: number): string {
    const mins = Math.round(minutes);
    if (mins === 0) return "0m";
    return `+${mins}m`;
}

/**
 * Get current game time as a Date object
 * Based on journey start time + elapsed minutes
 */
export function getCurrentGameTime(): Date | null {
    const startTime = journeyStartTime.value;
    if (!startTime) return null;
    return new Date(startTime + elapsedMinutes.value * 60 * 1000);
}

/**
 * Get scheduled time as a Date object
 * @param minutesFromStart - Minutes from journey start
 */
export function getScheduledTime(minutesFromStart: number): Date | null {
    const startTime = journeyStartTime.value;
    if (!startTime) return null;
    return new Date(startTime + minutesFromStart * 60 * 1000);
}

/**
 * Format a Date as HH:MM or HH:MM:SS (24-hour format)
 */
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

/**
 * Get predicted arrival time (scheduled + delay) as a Date
 */
export function getPredictedTime(scheduledMinutesFromStart: number, delayMinutes: number): Date | null {
    const startTime = journeyStartTime.value;
    if (!startTime) return null;
    return new Date(startTime + (scheduledMinutesFromStart + delayMinutes) * 60 * 1000);
}

/**
 * Format time delta for game display
 * Returns object with text and status for styling
 */
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

/**
 * Get time remaining until scheduled departure for a stop
 * Can be negative if past departure time
 */
export function getTimeUntilDeparture(stopIndex: number): number {
    const stopsArr = stops.value;
    const elapsed = elapsedMinutes.value;

    if (stopIndex >= stopsArr.length) return 0;

    return stopsArr[stopIndex].departureTime - elapsed;
}

/**
 * Get time remaining until scheduled arrival for a stop
 * Can be negative if past arrival time
 */
export function getTimeUntilArrival(stopIndex: number): number {
    const stopsArr = stops.value;
    const elapsed = elapsedMinutes.value;

    if (stopIndex >= stopsArr.length) return 0;

    return stopsArr[stopIndex].arrivalTime - elapsed;
}
