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
    new_station: boolean;
    station_code: string;
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
    first_station_new: boolean;
    first_station_code: string;
}

/**
 * Start a journey session for server-side tracking
 */
export async function startJourneySession(stationCodes: string[]): Promise<JourneyStartResponse | null> {
    try {
        const headers = await getAuthHeaders();
        if (!headers) return null;

        const response = await fetch(`${API_BASE}/journey/start`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ station_codes: stationCodes }),
        });

        if (!response.ok) return null;
        return await response.json();
    } catch (err) {
        console.error('Failed to start journey session:', err);
        return null;
    }
}

/**
 * Report arrival at a station
 */
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

/**
 * Fetch user stats (total km, visited stations)
 */
export async function fetchUserStats(): Promise<UserStats | null> {
    try {
        const headers = await getAuthHeaders();
        if (!headers) return null;

        const response = await fetch(`${API_BASE}/stats`, { headers });
        if (!response.ok) return null;
        return await response.json();
    } catch (err) {
        console.error('Failed to fetch user stats:', err);
        return null;
    }
}
