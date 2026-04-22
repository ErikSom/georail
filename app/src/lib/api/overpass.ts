export interface OverpassWay {
    id: number;
    role: string;
    nodes: number[]; // ordered OSM node ids — first and last are endpoints
    geometry: [number, number][]; // [[lon, lat], ...] same length as nodes
    tags: {
        name: string | null;
        ref: string | null;
        maxspeed: string | null;
        railway: string | null;
        usage: string | null;
    };
}

export interface OverpassStop {
    osm_node_id: number;
    role: string;
    name: string;
    lat: number;
    lon: number;
    track: string | null;
    railway: string | null;
    railway_ref: string | null;
}

export interface OverpassRelationTags {
    name: string | null;
    from: string | null;
    to: string | null;
    operator: string | null;
    network: string | null;
}

export interface OverpassRouteResponse {
    osm_ref: string;
    osm_relation_id: number;
    relation_tags: OverpassRelationTags;
    ways: OverpassWay[];
    // Ordered relation member list (with duplicates for terminal reversals).
    itinerary: number[];
    stops: OverpassStop[];
}

export const fetchOverpassRoute = async (ref: string): Promise<OverpassRouteResponse> => {
    const url = `${import.meta.env.PUBLIC_GEORAIL_URL}/overpass/route?ref=${encodeURIComponent(ref)}`;

    const response = await fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(errorData.error || `Overpass fetch failed: ${response.status}`);
    }

    return await response.json() as OverpassRouteResponse;
};
