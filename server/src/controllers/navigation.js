import { supabase } from '../supabase.js';

const MAX_STOPS = 30; // Realistic max for NL train journeys

/**
 * Parse compact stops string: "ASD-7a,HN-1" or "ASD,HN"
 * Returns array of { code, track? }
 */
function parseStopsParam(stopsParam) {
    if (!stopsParam || typeof stopsParam !== 'string') {
        return null;
    }

    const stops = stopsParam.split(',').map(s => {
        const parts = s.trim().split('-');
        const code = parts[0];
        const track = parts[1] || null;
        return { code, track };
    });

    return stops;
}

/**
 * Find route for an entire journey (multiple stops)
 * GET /navi/journey?s=ASD-7a,HN-1&editor=true
 * Compact URL format for Cloudflare caching
 */
export const findJourneyRoute = async (req, res) => {
    const { s: stopsParam, editor } = req.query;
    const isEditorMode = (editor === 'true');

    // Parse compact stops format
    const stops = parseStopsParam(stopsParam);

    if (!stops || stops.length < 2) {
        return res.status(400).json({ error: 'Query param "s" must contain at least 2 stops (e.g., s=ASD-7a,HN-1)' });
    }

    if (stops.length > MAX_STOPS) {
        return res.status(400).json({ error: `Too many stops. Maximum is ${MAX_STOPS}.` });
    }

    // Validate each stop has a code and check for duplicates
    const seenCodes = new Set();
    for (const stop of stops) {
        if (!stop.code) {
            return res.status(400).json({ error: 'Each stop must have a station code.' });
        }
        if (seenCodes.has(stop.code)) {
            return res.status(400).json({ error: 'Each station can only appear once in the route.' });
        }
        seenCodes.add(stop.code);
    }

    // Call the database function (now using codes)
    const { data: route, error: routeError } = await supabase.rpc('find_journey_route', {
        stops: stops,
        editor: isEditorMode
    });

    if (routeError) {
        return res.status(500).json({ error: `Route finding error: ${routeError.message}` });
    }

    if (!route || route.error) {
        return res.status(404).json({ error: route?.error || 'No path found for the journey.' });
    }

    // Cache headers for Cloudflare (7 days CDN cache, browser must revalidate)
    res.set('Cache-Control', 'public, s-maxage=604800, max-age=0, must-revalidate');
    res.set('Vary', 'Accept-Encoding');

    res.json({
        type: "Feature",
        geometry: route,
        properties: {
            stop_count: stops.length
        }
    });
};

/**
 * Find every rail point inside a circular area
 * GET /navi/area?lat=52.0801&lon=4.3250&radius=300&country=NL
 * Returns the same shape as /navi/journey so the editor can render the
 * result with its existing RouteEditor.
 */
export const findAreaRoute = async (req, res) => {
    const { lat, lon, radius, country } = req.query;

    const latNum = parseFloat(lat);
    const lonNum = parseFloat(lon);
    const radiusNum = parseFloat(radius);

    if (!Number.isFinite(latNum) || !Number.isFinite(lonNum) || !Number.isFinite(radiusNum)) {
        return res.status(400).json({ error: 'Query params lat, lon, radius must be numbers.' });
    }
    if (radiusNum <= 0 || radiusNum > 5000) {
        return res.status(400).json({ error: 'radius must be between 1 and 5000 meters.' });
    }

    const { data: route, error: routeError } = await supabase.rpc('get_rail_in_area', {
        p_lat: latNum,
        p_lon: lonNum,
        p_radius_m: radiusNum,
        p_country: (country || 'NL').toString().toUpperCase()
    });

    if (routeError) {
        return res.status(500).json({ error: `Area query error: ${routeError.message}` });
    }

    res.set('Cache-Control', 'public, s-maxage=604800, max-age=0, must-revalidate');
    res.set('Vary', 'Accept-Encoding');

    res.json({
        type: "Feature",
        geometry: route,
        properties: {
            stop_count: 0
        }
    });
};
