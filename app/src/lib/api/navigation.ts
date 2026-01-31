export interface EditorPoint {
    segment_id: number;
    index: number;
}

export interface JourneyStopInput {
    code: string;  // Short station code (e.g., "ASD", "HN")
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
    const url = `${import.meta.env.PUBLIC_GEORAIL_URL}/navi/journey?s=${stopsParam}${editorParam}`;

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