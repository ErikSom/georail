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

export type OverpassLookup =
    | { ref: string }
    | { name: string }
    | { relationId: number };

export type RouteType = 'train' | 'light_rail' | 'tracks' | 'tram' | 'subway' | 'monorail';

export interface OverpassSearchResult {
    id: number;
    name: string | null;
    ref: string | null;
    route: string | null;
    operator: string | null;
    network: string | null;
    from: string | null;
    to: string | null;
    service: string | null;
}

export const ROUTE_TYPES: RouteType[] = ['train', 'light_rail', 'tracks', 'tram', 'subway', 'monorail'];

export const searchOverpassRoutes = async (q: string, types: RouteType[]): Promise<OverpassSearchResult[]> => {
    const params = new URLSearchParams({ q });
    if (types.length > 0) params.set('types', types.join(','));
    const url = `${import.meta.env.PUBLIC_GEORAIL_URL}/overpass/search?${params.toString()}`;
    const response = await fetch(url, { method: 'GET', headers: { 'Accept': 'application/json' } });
    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Search failed: ${response.status}`);
    }
    const data = await response.json();
    return (data.results || []) as OverpassSearchResult[];
};

export const fetchOverpassRoute = async (lookup: OverpassLookup | string): Promise<OverpassRouteResponse> => {
    // String overload preserves the original `fetchOverpassRoute("ICE 26")` API.
    const params = new URLSearchParams();
    if (typeof lookup === 'string') {
        params.set('ref', lookup);
    } else if ('ref' in lookup) {
        params.set('ref', lookup.ref);
    } else if ('name' in lookup) {
        params.set('name', lookup.name);
    } else {
        params.set('relationId', String(lookup.relationId));
    }
    const url = `${import.meta.env.PUBLIC_GEORAIL_URL}/overpass/route?${params.toString()}`;

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
