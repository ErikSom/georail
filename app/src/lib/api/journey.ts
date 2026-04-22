import { supabase } from '../Supabase';

const API_BASE = `${import.meta.env.PUBLIC_GEORAIL_URL}/user`;

async function getAuthHeaders(): Promise<Record<string, string> | null> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    return {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
    };
}

export interface StationArrivalResponse {
    valid: boolean;
    km_added: number;
    total_km: number;
    is_complete: boolean;
    total_stations_visited: number;
    journey_km: number;
}

export interface UserStats {
    total_km: number;
    stations_visited: string[];
    total_stations_visited: number;
}

export interface JourneyStartResponse {
    session_id: string;
    already_visited: string[];
}

export interface StartJourneySessionOptions {
    isUserRoute?: boolean;
    userRouteId?: string | null;
    stationCoords?: [number, number][];
}

export async function startJourneySession(
    stationCodes: string[],
    country: string,
    segmentDistances: number[],
    stationTracks: (string | null)[],
    isRoundTrip?: boolean,
    options?: StartJourneySessionOptions,
): Promise<JourneyStartResponse | null> {
    try {
        const headers = await getAuthHeaders();
        if (!headers) return null;

        const body: Record<string, unknown> = {
            station_codes: stationCodes,
            country,
            segment_distances: segmentDistances,
            station_tracks: stationTracks,
            is_round_trip: !!isRoundTrip,
        };

        if (options?.isUserRoute) {
            body.is_user_route = true;
            body.user_route_id = options.userRouteId ?? null;
            if (options.stationCoords) body.station_coords = options.stationCoords;
        }

        const response = await fetch(`${API_BASE}/journey/start`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        });

        if (!response.ok) return null;
        return await response.json();
    } catch (err) {
        console.error('Failed to start journey session:', err);
        return null;
    }
}

export async function reportStationArrival(
    sessionId: string,
    stationIndex: number,
): Promise<StationArrivalResponse | null> {
    try {
        const headers = await getAuthHeaders();
        if (!headers) return null;

        const response = await fetch(`${API_BASE}/journey/station`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ session_id: sessionId, station_index: stationIndex }),
        });

        if (!response.ok) return null;
        return await response.json();
    } catch (err) {
        console.error('Failed to report station arrival:', err);
        return null;
    }
}

export interface JourneyHistoryEntry {
    id: string;
    station_codes: string[];
    station_tracks: (string | null)[] | null;
    total_km: number;
    total_km_earned: number;
    started_at: string;
    country: string;
    is_round_trip: boolean;
    route_hash: string;
    is_favorited: boolean;
}

export interface FavoriteRoute {
    id: string;
    route_hash: string;
    station_codes: string[];
    station_names: string[] | null;
    station_tracks: (string | null)[] | null;
    total_km: number | null;
    is_round_trip: boolean;
    country: string;
    created_at: string;
}

export async function fetchJourneyHistory(country: string): Promise<{ history: JourneyHistoryEntry[] } | null> {
    try {
        const headers = await getAuthHeaders();
        if (!headers) return null;

        const response = await fetch(`${API_BASE}/journey/history?country=${encodeURIComponent(country)}`, { headers });
        if (!response.ok) return null;
        return await response.json();
    } catch (err) {
        console.error('Failed to fetch journey history:', err);
        return null;
    }
}

export async function fetchFavoriteRoutes(country: string): Promise<{ favorites: FavoriteRoute[] } | null> {
    try {
        const headers = await getAuthHeaders();
        if (!headers) return null;

        const response = await fetch(`${API_BASE}/journey/favorites?country=${encodeURIComponent(country)}`, { headers });
        if (!response.ok) return null;
        return await response.json();
    } catch (err) {
        console.error('Failed to fetch favorite routes:', err);
        return null;
    }
}

export async function toggleFavorite(
    stationCodes: string[],
    stationNames?: string[],
    totalKm?: number,
    country?: string,
    isRoundTrip?: boolean,
    stationTracks?: (string | null)[],
): Promise<{ favorited: boolean } | null> {
    try {
        const headers = await getAuthHeaders();
        if (!headers) return null;

        const response = await fetch(`${API_BASE}/journey/favorite`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                station_codes: stationCodes,
                station_names: stationNames,
                station_tracks: stationTracks,
                total_km: totalKm,
                is_round_trip: !!isRoundTrip,
                country: country || 'NL',
            }),
        });

        if (!response.ok) {
            const body = await response.json().catch(() => null);
            throw new Error(body?.error || 'Failed to toggle favorite');
        }
        return await response.json();
    } catch (err) {
        if (err instanceof Error) throw err;
        throw new Error('Failed to toggle favorite');
    }
}

export async function fetchUserStats(country: string): Promise<UserStats | null> {
    try {
        const headers = await getAuthHeaders();
        if (!headers) return null;

        const response = await fetch(`${API_BASE}/stats?country=${encodeURIComponent(country)}`, { headers });
        if (!response.ok) return null;
        return await response.json();
    } catch (err) {
        console.error('Failed to fetch user stats:', err);
        return null;
    }
}
