const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const OVERPASS_TIMEOUT_MS = 65000;

function buildRouteQuery(ref) {
    const safeRef = ref.replace(/"/g, '');
    return `[out:json][timeout:60];
relation["route"="train"]["ref"="${safeRef}"];
(._; >;);
out geom;`;
}

function pickRelation(elements) {
    return elements.find(e => e.type === 'relation' && e.tags?.route === 'train') || null;
}

// Role comes from the relation membership (not the way itself).
const PLATFORM_ROLES = new Set(['platform', 'platform_entry_only', 'platform_exit_only', 'stop', 'stop_entry_only', 'stop_exit_only']);
const NON_TRACK_RAILWAY = new Set(['platform', 'platform_edge']);

// Returns { ways, itinerary }: `ways` is deduped (unique geometry per id),
// `itinerary` is the ordered list of way ids from the relation, INCLUDING
// duplicates. Terminal stations model reversals as the same way listed twice
// in sequence — the itinerary preserves that, ways dedupes for storage.
function extractWaysAndItinerary(relation, waysById) {
    const ways = [];
    const itinerary = [];
    const seen = new Set();

    for (const m of relation.members) {
        if (m.type !== 'way') continue;

        if (PLATFORM_ROLES.has(m.role)) continue;

        const way = waysById.get(m.ref);
        if (!way || !way.geometry || way.geometry.length < 2) continue;
        if (NON_TRACK_RAILWAY.has(way.tags?.railway)) continue;

        itinerary.push(m.ref);

        if (seen.has(m.ref)) continue;
        seen.add(m.ref);

        ways.push({
            id: m.ref,
            role: m.role || '',
            nodes: way.nodes || [],
            geometry: way.geometry.map(p => [p.lon, p.lat]),
            tags: {
                name: way.tags?.name || null,
                ref: way.tags?.ref || null,
                maxspeed: way.tags?.maxspeed || null,
                railway: way.tags?.railway || null,
                usage: way.tags?.usage || null,
            },
        });
    }
    return { ways, itinerary };
}

function extractStops(relation, nodesById) {
    const stops = [];
    const seen = new Set();

    for (const m of relation.members) {
        if (m.type !== 'node') continue;
        const isStopRole = m.role === 'stop' || m.role === 'stop_entry_only' || m.role === 'stop_exit_only';
        const node = nodesById.get(m.ref);
        if (!node) continue;
        const isStation = node.tags?.railway === 'station' || node.tags?.railway === 'halt';
        if (!isStopRole && !isStation) continue;
        if (seen.has(m.ref)) continue;
        seen.add(m.ref);

        stops.push({
            osm_node_id: m.ref,
            role: m.role || '',
            name: node.tags?.name || node.tags?.['name:en'] || `Stop ${m.ref}`,
            lat: node.lat,
            lon: node.lon,
            track: node.tags?.['railway:track_ref'] || null,
            railway: node.tags?.railway || null,
            // Official operator short-code (e.g. RTD, RK, ASD).
            railway_ref: node.tags?.['railway:ref'] || node.tags?.['ref:NS'] || node.tags?.ref || null,
        });
    }
    return stops;
}

// GET /overpass/route?ref=ICE%2026 — returns raw ways + stops; client stitches.
export const fetchOverpassRoute = async (req, res) => {
    const { ref } = req.query;
    if (!ref || typeof ref !== 'string' || ref.length > 40) {
        return res.status(400).json({ error: 'Query param "ref" is required (e.g., ref=ICE%2026)' });
    }

    const query = buildRouteQuery(ref);

    let overpassJson;
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT_MS);

        const overpassRes = await fetch(OVERPASS_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain; charset=utf-8',
                'Accept': 'application/json',
                'User-Agent': 'GeoRail/1.0',
            },
            body: query,
            signal: controller.signal,
        });
        clearTimeout(timer);

        if (!overpassRes.ok) {
            return res.status(502).json({ error: `Overpass API error: ${overpassRes.status}` });
        }
        overpassJson = await overpassRes.json();
    } catch (err) {
        if (err.name === 'AbortError') {
            return res.status(504).json({ error: 'Overpass API timed out.' });
        }
        return res.status(502).json({ error: `Failed to reach Overpass API: ${err.message}` });
    }

    const elements = overpassJson.elements || [];
    const relation = pickRelation(elements);
    if (!relation) {
        return res.status(404).json({ error: `No train route found for ref="${ref}".` });
    }

    const nodesById = new Map();
    const waysById = new Map();
    for (const el of elements) {
        if (el.type === 'node') nodesById.set(el.id, el);
        else if (el.type === 'way') waysById.set(el.id, el);
    }

    const { ways, itinerary } = extractWaysAndItinerary(relation, waysById);
    const stops = extractStops(relation, nodesById);

    if (ways.length === 0) {
        return res.status(422).json({ error: 'Route has no way members with geometry.' });
    }

    res.set('Cache-Control', 'public, s-maxage=86400, max-age=3600');

    res.json({
        osm_ref: ref,
        osm_relation_id: relation.id,
        relation_tags: {
            name: relation.tags?.name || null,
            from: relation.tags?.from || null,
            to: relation.tags?.to || null,
            operator: relation.tags?.operator || null,
            network: relation.tags?.network || null,
        },
        ways,
        itinerary,
        stops,
    });
};
