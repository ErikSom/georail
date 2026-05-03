export interface EditorPoint {
    segment_id: number;
    index: number;
}

export interface JourneyStopInput {
    code: string;  // Short station code (e.g., "ASD", "HN")
    track?: string;
}

export interface RoutePointMetadata {
    max_speed: number | null;
    source: 'manual' | 'seed' | null;
}

export interface JourneyRouteData {
    geometry: {
        route: number[][]; // [lon, lat, world_offset_x, world_offset_y, world_offset_z]
        metadata: RoutePointMetadata[]; // Metadata for each route point
        stop_indices: number[]; // Indices in route array where each stop is located
        editor?: EditorPoint[];
    };
    properties: {
        stop_count: number;
    };
}

export interface RouteStop {
    station: string;
    code: string;          // Station code (e.g., "ASD", "HN")
    track: string | null;
    arrivalTime: number;   // Minutes from journey start (first stop = 0)
    departureTime: number; // Minutes from journey start (first stop = arrivalTime + 1)
}

export interface RouteData {
    geometry: {
        route: number[][]; // [lon, lat, world_offset_x, world_offset_y, world_offset_z]
        metadata: RoutePointMetadata[]; // Metadata for each route point
        stop_indices: number[]; // Indices in route array where each stop is located
        editor?: EditorPoint[];
        turnaround_indices?: number[]; // Route-point indices where train reverses direction (terminal stations).
    };
    properties: {
        stops: RouteStop[];
        startTime?: number; // Optional custom start time (timestamp) for the journey clock
    }
}

import { configs } from '../../store/globals';

/**
 * Calculate distance between two points in meters using Haversine formula
 */
function haversineDistance(lon1: number, lat1: number, lon2: number, lat2: number): number {
    const R = 6371000; // Earth radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Calculate arrival and departure times for each stop based on route geometry and speed data
 * @param stopNames - Array of station names for each stop
 * @param stopCodes - Array of station codes for each stop
 * @param stopTracks - Array of track identifiers (or null) for each stop
 * @param geometry - The journey geometry containing route, metadata, and stop_indices
 * @returns Array of RouteStop with calculated arrival/departure times
 */
export function calculateStopTimes(
    stopNames: string[],
    stopCodes: string[],
    stopTracks: (string | null)[],
    geometry: JourneyRouteData['geometry']
): RouteStop[] {
    const { route, metadata, stop_indices } = geometry;
    const DEFAULT_SPEED_KMH = 80;

    const { initialDwellTime, minStopDwellTime, maxStopDwellTime } = configs.value;

    return stopNames.map((station, stopIdx) => {
        const code = stopCodes[stopIdx] || '';
        const track = stopTracks[stopIdx];

        if (stopIdx === 0) {
            return { station, code, track, arrivalTime: 0, departureTime: initialDwellTime };
        }

        // Random dwell time between min and max for intermediate stops
        const dwellTime = Math.floor(Math.random() * (maxStopDwellTime - minStopDwellTime + 1)) + minStopDwellTime;

        // Get route indices for this segment (direction-agnostic for round trips)
        const rawStart = stop_indices[stopIdx - 1];
        const rawEnd = stop_indices[stopIdx];
        const startRouteIdx = Math.min(rawStart, rawEnd);
        const endRouteIdx = Math.max(rawStart, rawEnd);

        // Sum distance and calculate weighted average speed for this segment
        let segmentDistance = 0;
        let weightedSpeedSum = 0;

        for (let i = startRouteIdx; i < endRouteIdx; i++) {
            const [lon1, lat1] = route[i];
            const [lon2, lat2] = route[i + 1];
            const pointDistance = haversineDistance(lon1, lat1, lon2, lat2);
            const maxSpeed = metadata[i]?.max_speed || DEFAULT_SPEED_KMH;

            segmentDistance += pointDistance;
            weightedSpeedSum += pointDistance * maxSpeed;
        }

        // Calculate average speed for segment (km/h) and travel time (minutes)
        const avgSpeedKmh = segmentDistance > 0 ? weightedSpeedSum / segmentDistance : DEFAULT_SPEED_KMH;
        const travelTimeMinutes = (segmentDistance / 1000) / avgSpeedKmh * 60;

        // Accumulate time from start (sum of all previous segments + dwell times)
        // Use average of min/max for intermediate stop dwell estimates
        const avgDwellTime = (minStopDwellTime + maxStopDwellTime) / 2;
        let cumulativeTime = initialDwellTime; // First stop departure
        for (let prevIdx = 1; prevIdx < stopIdx; prevIdx++) {
            const prevRawStart = stop_indices[prevIdx - 1];
            const prevRawEnd = stop_indices[prevIdx];
            const prevStart = Math.min(prevRawStart, prevRawEnd);
            const prevEnd = Math.max(prevRawStart, prevRawEnd);
            let prevDistance = 0;
            let prevWeightedSpeed = 0;

            for (let i = prevStart; i < prevEnd; i++) {
                const [lon1, lat1] = route[i];
                const [lon2, lat2] = route[i + 1];
                const d = haversineDistance(lon1, lat1, lon2, lat2);
                prevDistance += d;
                prevWeightedSpeed += d * (metadata[i]?.max_speed || DEFAULT_SPEED_KMH);
            }

            const prevAvgSpeed = prevDistance > 0 ? prevWeightedSpeed / prevDistance : DEFAULT_SPEED_KMH;
            cumulativeTime += (prevDistance / 1000) / prevAvgSpeed * 60 + avgDwellTime;
        }

        const arrivalTime = Math.round(cumulativeTime + travelTimeMinutes);
        const departureTime = arrivalTime + dwellTime;

        return { station, code, track, arrivalTime, departureTime };
    });
}

/**
 * Build compact stops string for URL: "ASD-7a,HN-1" or "ASD,HN" without tracks
 * Encodes individual parts but keeps delimiters (- and ,) clean for readable URLs
 */
function encodeStops(stops: JourneyStopInput[]): string {
    return stops.map(s => {
        const code = encodeURIComponent(s.code);
        return s.track ? `${code}-${encodeURIComponent(s.track)}` : code;
    }).join(',');
}

/**
 * Fetch route for an entire journey (multiple stops)
 * Uses GET with compact URL format for Cloudflare caching
 * Format: /navi/journey?s=ASD-7a,HN-1&editor=true
 */
export const fetchJourneyRoute = async (stops: JourneyStopInput[], editor: boolean = false): Promise<JourneyRouteData> => {
    if (stops.length < 2) {
        throw new Error('At least 2 stops required');
    }

    const stopsParam = encodeStops(stops);
    const editorParam = editor ? '&editor=true' : '';
    // Dev only: append `?nocache=1` to the page URL to bypass Cloudflare's
    // /navi/journey cache (e.g. after a fresh seed). Without the flag, dev
    // uses the cached response same as production.
    const bypassCache = import.meta.env.DEV
        && typeof window !== 'undefined'
        && new URLSearchParams(window.location.search).has('nocache');
    const cacheBust = bypassCache ? `&cb=${Date.now()}` : '';
    const url = `${import.meta.env.PUBLIC_GEORAIL_URL}/navi/journey?s=${stopsParam}${editorParam}${cacheBust}`;

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `Server error: ${response.status}`);
        }

        return await response.json() as JourneyRouteData;

    } catch (error) {
        console.error('Failed to fetch journey route:', error);
        throw error;
    }
};

/**
 * Fetch every rail point inside a circular area. Returns the same shape as
 * fetchJourneyRoute, so the editor can consume it with the same RouteEditor.
 */
export const fetchAreaRoute = async (lat: number, lon: number, radiusM: number, countryCode: string = 'NL'): Promise<JourneyRouteData> => {
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(radiusM)) {
        throw new Error('lat, lon, and radius must be numbers');
    }
    if (radiusM <= 0 || radiusM > 5000) {
        throw new Error('radius must be between 1 and 5000 meters');
    }

    const bypassCache = import.meta.env.DEV
        && typeof window !== 'undefined'
        && new URLSearchParams(window.location.search).has('nocache');
    const cacheBust = bypassCache ? `&cb=${Date.now()}` : '';

    const params = new URLSearchParams({
        lat: String(lat),
        lon: String(lon),
        radius: String(radiusM),
        country: countryCode,
    });
    const url = `${import.meta.env.PUBLIC_GEORAIL_URL}/navi/area?${params.toString()}${cacheBust}`;

    const response = await fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.error || `Server error: ${response.status}`);
    }

    return await response.json() as JourneyRouteData;
};