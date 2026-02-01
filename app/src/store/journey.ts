import { signal, computed } from "@preact/signals";
import type { RouteData, RouteStop } from "../lib/api/navigation";
import { trainDistanceTraveled, trainPathTotalLength, trainVelocityKmh, trainLength } from "./train";
import { configs } from "./globals";

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
    const isStopped = velocity < 1;

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
 */
export function updateElapsedTime(): void {
    if (!journeyStartTime.value) {
        elapsedMinutes.value = 0;
        return;
    }
    elapsedMinutes.value = (Date.now() - journeyStartTime.value) / 60000;
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
 */
export function distanceToStop(stopIndex: number): number {
    const distances = stopDistances.value;

    if (distances.length === 0 || stopIndex >= distances.length) {
        return 0;
    }

    const trainDistance = trainDistanceTraveled.value / 1000; // Convert m to km
    const stopDistance = distances[stopIndex];

    // Return remaining distance (0 if already past)
    return Math.max(0, stopDistance - trainDistance);
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
 */
export function startJourney(route: RouteData): void {
    routeData.value = route;
    journeyStartTime.value = Date.now();
    currentRouteIndex.value = 0;
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
 */
export function formatDistance(km: number): string {
    if (km < 1) {
        return `${Math.round(km * 1000)} m`;
    }
    return `${km.toFixed(1)} km`;
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
