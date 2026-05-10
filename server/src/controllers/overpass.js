const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const OVERPASS_TIMEOUT_MS = 65000;

// Route types we accept as railway lines. Includes both scheduled-service
// relations (train, light_rail, tram, subway) and infrastructure-only
// relations (tracks) — heritage / museum lines are usually tagged as
// `route=tracks` or `route=light_rail` rather than `route=train`.
const ROUTE_TYPES = ['train', 'light_rail', 'tracks', 'tram', 'subway', 'monorail'];
const ROUTE_TYPE_REGEX = `^(${ROUTE_TYPES.join('|')})$`;
const ROUTE_TYPE_SET = new Set(ROUTE_TYPES);

function escapeOverpass(s) {
    // Strip characters that would break out of the Overpass string literal.
    return s.replace(/["\\]/g, '');
}

// Looks up by exact ref, fuzzy name/operator match, or direct relation id.
// Name search unions name+operator+from+to so heritage lines (which often
// have the operator in `operator` not `name`) still resolve.
function buildRouteQuery({ ref, name, relationId }) {
    if (relationId) {
        return `[out:json][timeout:60];
relation(${relationId});
(._; >;);
out geom;`;
    }
    if (ref) {
        return `[out:json][timeout:60];
relation["route"~"${ROUTE_TYPE_REGEX}"]["ref"="${escapeOverpass(ref)}"];
(._; >;);
out geom;`;
    }
    // Name search is intentionally permissive — no route= filter, since
    // heritage lines often tag the relation with route=tracks (broad) or
    // omit route entirely. We rely on the name being specific enough.
    const safe = escapeOverpass(name);
    return `[out:json][timeout:60];
(
  relation["name"~"${safe}",i];
  relation["operator"~"${safe}",i];
  relation["from"~"${safe}",i];
  relation["to"~"${safe}",i];
);
(._; >;);
out geom;`;
}

function pickRelation(elements, { allowAnyRoute = false } = {}) {
    // Direct relation-id lookups bypass the route-type filter so users can
    // import a relation even if its `route` tag is unusual.
    return elements.find(e => e.type === 'relation' && (allowAnyRoute || ROUTE_TYPE_SET.has(e.tags?.route))) || null;
}

// Search query — returns relation TAGS only, no way geometry. Cheap (~500ms).
// Searches across name, operator, from, to, ref, network for the query string.
function buildSearchQuery({ q, types }) {
    const safe = escapeOverpass(q);
    const typeRegex = `^(${types.join('|')})$`;
    return `[out:json][timeout:30];
(
  relation["route"~"${typeRegex}"]["name"~"${safe}",i];
  relation["route"~"${typeRegex}"]["operator"~"${safe}",i];
  relation["route"~"${typeRegex}"]["from"~"${safe}",i];
  relation["route"~"${typeRegex}"]["to"~"${safe}",i];
  relation["route"~"${typeRegex}"]["ref"~"${safe}",i];
  relation["route"~"${typeRegex}"]["network"~"${safe}",i];
);
out tags;`;
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
    const { ref, name, relationId } = req.query;
    const refStr = typeof ref === 'string' ? ref.trim() : '';
    const nameStr = typeof name === 'string' ? name.trim() : '';
    const relStr = typeof relationId === 'string' ? relationId.trim() : '';
    const relNum = /^\d+$/.test(relStr) ? Number(relStr) : null;

    if (!refStr && !nameStr && !relNum) {
        return res.status(400).json({ error: 'Provide "ref", "name", or "relationId".' });
    }
    if (refStr && refStr.length > 40) {
        return res.status(400).json({ error: '"ref" must be at most 40 characters.' });
    }
    if (nameStr && (nameStr.length < 3 || nameStr.length > 80)) {
        return res.status(400).json({ error: '"name" must be 3–80 characters.' });
    }
    if (relStr && !relNum) {
        return res.status(400).json({ error: '"relationId" must be a positive integer.' });
    }

    const query = buildRouteQuery({ ref: refStr || null, name: nameStr || null, relationId: relNum });

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
    // Name and relation-ID lookups bypass the route-type filter so we can
    // import unusually-tagged heritage relations.
    const relation = pickRelation(elements, { allowAnyRoute: relNum != null || nameStr.length > 0 });
    if (!relation) {
        const lookup = relNum ? `relation ${relNum}` : (refStr ? `ref="${refStr}"` : `name~"${nameStr}"`);
        return res.status(404).json({ error: `No railway route found for ${lookup}.` });
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
        osm_ref: relation.tags?.ref || refStr || '',
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

// GET /overpass/search?q=ICE&types=train,tram — returns up to 50 candidate
// relations with tags only (no geometry). Used by the editor's search UI.
export const searchOverpassRoutes = async (req, res) => {
    const { q, types } = req.query;
    const qStr = typeof q === 'string' ? q.trim() : '';
    if (!qStr || qStr.length < 2 || qStr.length > 80) {
        return res.status(400).json({ error: '"q" must be 2–80 characters.' });
    }

    const requested = typeof types === 'string'
        ? types.split(',').map(t => t.trim()).filter(Boolean)
        : ROUTE_TYPES;
    const filteredTypes = requested.filter(t => ROUTE_TYPE_SET.has(t));
    const useTypes = filteredTypes.length > 0 ? filteredTypes : ROUTE_TYPES;

    const query = buildSearchQuery({ q: qStr, types: useTypes });

    let overpassJson;
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 35_000);
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
    const seen = new Set();
    const results = [];
    for (const el of elements) {
        if (el.type !== 'relation') continue;
        if (seen.has(el.id)) continue;
        seen.add(el.id);
        results.push({
            id: el.id,
            name: el.tags?.name || null,
            ref: el.tags?.ref || null,
            route: el.tags?.route || null,
            operator: el.tags?.operator || null,
            network: el.tags?.network || null,
            from: el.tags?.from || null,
            to: el.tags?.to || null,
            service: el.tags?.service || null,
        });
        if (results.length >= 50) break;
    }

    res.set('Cache-Control', 'public, s-maxage=3600, max-age=60');
    res.json({ results });
};
