import { supabase } from '../supabase.js';
import { fnvHash } from '../../../shared/hash.secure.js';

const MAX_BODY_SIZE = 500 * 1024; // 500KB max
const MAX_STOPS = 100;

/**
 * Find route for an entire journey (multiple stops)
 * POST body: { stops: [{ name: string, track?: string }, ...] }
 * Query param 'h' is the hash of the body for Cloudflare caching (client generates it)
 */
export const findJourneyRoute = async (req, res) => {
    const { h: hash, editor } = req.query;
    const { stops } = req.body;
    const isEditorMode = (editor === 'true');

    // Validate hash is provided
    if (!hash) {
        return res.status(400).json({ error: 'Missing hash query parameter "h".' });
    }

    // Check body size (express.json should have already parsed, but check stringified size)
    const bodyString = JSON.stringify(req.body);
    if (bodyString.length > MAX_BODY_SIZE) {
        return res.status(413).json({ error: 'Request body too large.' });
    }

    // Validate stops array
    if (!stops || !Array.isArray(stops) || stops.length < 2) {
        return res.status(400).json({ error: 'Body must contain "stops" array with at least 2 stops.' });
    }

    if (stops.length > MAX_STOPS) {
        return res.status(400).json({ error: `Too many stops. Maximum is ${MAX_STOPS}.` });
    }

    // Validate each stop has required fields
    for (const stop of stops) {
        if (!stop.name) {
            return res.status(400).json({ error: 'Each stop must have a "name" field.' });
        }
    }

    // Verify hash matches body
    const stopsJson = JSON.stringify(stops);
    console.log('Server stops JSON:', stopsJson);
    const expectedHash = fnvHash(stopsJson);
    console.log('Server hash:', expectedHash, 'Client hash:', hash);
    if (hash !== expectedHash) {
        return res.status(400).json({ error: 'Hash does not match body content.' });
    }

    // Call the database function
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

    // Cache based on the hash query param (Cloudflare caches by full URL including ?h=...)
    // 7 days CDN cache, browser must revalidate
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