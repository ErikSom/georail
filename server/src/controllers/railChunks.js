import { supabase } from '../supabase.js';

// 0.1° cells — same scale as liveTrainStore's bucket index. NL fits in
// roughly 530 cells. The cell index passed in the URL is the floor of the
// lower-left corner × 10 (e.g. cell (51, 520) covers lon ∈ [5.1, 5.2)
// and lat ∈ [52.0, 52.1)).
const CELL_SCALE = 10;
const DEFAULT_COUNTRY = 'NL';
const ALLOWED_COUNTRIES = new Set(['NL']);

export const getRailChunk = async (req, res) => {
    const lon = Number(req.params.lon);
    const lat = Number(req.params.lat);
    if (!Number.isInteger(lon) || !Number.isInteger(lat)) {
        return res.status(400).json({ error: 'lon and lat must be integers (cell indexes ×10)' });
    }
    const country = (req.query.country || DEFAULT_COUNTRY).toString().toUpperCase();
    if (!ALLOWED_COUNTRIES.has(country)) {
        return res.status(400).json({ error: `country must be one of ${[...ALLOWED_COUNTRIES].join(', ')}` });
    }

    const lonMin = lon / CELL_SCALE;
    const latMin = lat / CELL_SCALE;
    const lonMax = lonMin + 1 / CELL_SCALE;
    const latMax = latMin + 1 / CELL_SCALE;

    try {
        const { data, error } = await supabase.rpc('get_rail_chunk', {
            lon_min: lonMin,
            lat_min: latMin,
            lon_max: lonMax,
            lat_max: latMax,
            p_country: country,
        });
        if (error) throw error;
        const segments = typeof data === 'string' ? JSON.parse(data) : (data || []);

        // Rail geometry barely changes; cache aggressively. The client also
        // owns the invalidation responsibility via its own version key.
        res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=86400');
        res.json({
            cell: { lon, lat },
            bounds: { lonMin, latMin, lonMax, latMax },
            country,
            segments,
        });
    } catch (err) {
        console.error('[rail-chunks] error:', err.message || err);
        res.status(500).json({ error: 'failed to load rail chunk' });
    }
};
