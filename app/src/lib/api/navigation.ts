export interface EditorPoint {
    segment_id: number;
    index: number;
}

export interface JourneyStopInput {
    name: string;
    track?: string;
}

export interface JourneyRouteData {
    geometry: {
        start_node: number;
        end_node: number;
        route: number[][]; // [lon, lat, world_offset_x, world_offset_y, world_offset_z]
        editor?: EditorPoint[];
    };
    properties: {
        stop_count: number;
    };
}

export interface RouteData {
    geometry: {
        start_node: number;
        end_node: number;
        route: number[][]; // [lon, lat, world_offset_x, world_offset_y, world_offset_z]
        editor?: EditorPoint[];
    };
    properties: {
        from_station: string;
        from_track: string | null;
        to_station: string;
        to_track: string | null;
    }
}

import { fnvHash } from '../../../../shared/hash.secure.js';

/**
 * Fetch route for an entire journey (multiple stops)
 * The stops array is hashed and sent as query param for Cloudflare caching
 */
export const fetchJourneyRoute = async (stops: JourneyStopInput[], editor: boolean = false): Promise<JourneyRouteData> => {
    if (stops.length < 2) {
        throw new Error('At least 2 stops required');
    }

    const stopsJson = JSON.stringify(stops);
    console.log('Client stops JSON:', stopsJson);
    const hash = fnvHash(stopsJson);
    console.log('Client hash:', hash);
    const url = new URL(`${import.meta.env.PUBLIC_GEORAIL_URL}/navi/journey`);
    url.searchParams.append('h', hash);
    if (editor) {
        url.searchParams.append('editor', 'true');
    }

    try {
        const response = await fetch(url.toString(), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ stops })
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