import { getSupabaseForToken, supabase } from '../supabase.js';

// Caps — adjust here if usage patterns change.
const MAX_ROUTES_PER_USER = 10;
const MAX_POINTS_PER_USER = 100000;
const MAX_POINTS_PER_ROUTE = 50000;
const MAX_NAME_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 1000;

function validateRoutePayload(body) {
    const { name, description, geometry, stops } = body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return 'Name is required.';
    }
    if (name.length > MAX_NAME_LENGTH) {
        return `Name must be ${MAX_NAME_LENGTH} characters or fewer.`;
    }
    if (description != null && (typeof description !== 'string' || description.length > MAX_DESCRIPTION_LENGTH)) {
        return `Description must be a string of ${MAX_DESCRIPTION_LENGTH} characters or fewer.`;
    }
    if (!geometry || typeof geometry !== 'object' || !Array.isArray(geometry.route)) {
        return 'geometry.route is required.';
    }
    if (!Array.isArray(geometry.metadata) || !Array.isArray(geometry.stop_indices) || !Array.isArray(geometry.editor)) {
        return 'geometry.metadata, geometry.stop_indices, geometry.editor are required.';
    }
    if (geometry.route.length < 2) {
        return 'Route must have at least 2 points.';
    }
    if (geometry.route.length > MAX_POINTS_PER_ROUTE) {
        return `Route too large (${geometry.route.length} points, max ${MAX_POINTS_PER_ROUTE}).`;
    }
    if (!Array.isArray(stops) || stops.length === 0) {
        return 'At least one stop is required.';
    }
    return null;
}

// POST /user-routes
export const createUserRoute = async (req, res) => {
    const err = validateRoutePayload(req.body);
    if (err) return res.status(400).json({ error: err });

    const supabaseUser = getSupabaseForToken(req.authToken);

    const { data: existing, error: existingError } = await supabaseUser
        .from('user_routes')
        .select('id, point_count')
        .eq('user_id', req.userId);
    if (existingError) return res.status(500).json({ error: existingError.message });

    if (existing.length >= MAX_ROUTES_PER_USER) {
        return res.status(403).json({ error: `Route limit reached (${MAX_ROUTES_PER_USER}). Delete an old route first.` });
    }

    const pointCount = req.body.geometry.route.length;
    const currentTotal = existing.reduce((s, r) => s + (r.point_count || 0), 0);
    if (currentTotal + pointCount > MAX_POINTS_PER_USER) {
        return res.status(403).json({
            error: `Point quota would be exceeded (${currentTotal + pointCount} / ${MAX_POINTS_PER_USER}). Delete an old route first.`,
        });
    }

    const { name, description, osm_ref, osm_relation_id, geometry, stops, country } = req.body;

    const { data, error } = await supabaseUser
        .from('user_routes')
        .insert({
            user_id: req.userId,
            name: name.trim(),
            description: description?.trim() || null,
            osm_ref: osm_ref || null,
            osm_relation_id: osm_relation_id || null,
            geometry,
            stops,
            point_count: pointCount,
            country: country || null,
        })
        .select()
        .single();

    if (error) return res.status(500).json({ error: error.message });

    res.set('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    res.status(201).json(data);
};

// GET /user-routes/mine — lightweight list (no geometry blob)
export const listMyUserRoutes = async (req, res) => {
    const supabaseUser = getSupabaseForToken(req.authToken);

    const { data, error } = await supabaseUser
        .from('user_routes')
        .select('id, name, description, osm_ref, osm_relation_id, point_count, country, created_at, updated_at')
        .eq('user_id', req.userId)
        .order('updated_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    res.set('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    res.json({
        routes: data || [],
        caps: {
            maxRoutes: MAX_ROUTES_PER_USER,
            maxPoints: MAX_POINTS_PER_USER,
            usedPoints: (data || []).reduce((s, r) => s + (r.point_count || 0), 0),
        },
    });
};

// GET /user-routes/:id
export const getUserRoute = async (req, res) => {
    const { id } = req.params;
    const supabaseUser = getSupabaseForToken(req.authToken);

    const { data, error } = await supabaseUser
        .from('user_routes')
        .select('*')
        .eq('id', id)
        .eq('user_id', req.userId)
        .single();

    if (error || !data) return res.status(404).json({ error: 'Route not found.' });

    res.set('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    res.json(data);
};

// PATCH /user-routes/:id
export const updateUserRoute = async (req, res) => {
    const { id } = req.params;
    const supabaseUser = getSupabaseForToken(req.authToken);

    const update = {};
    if (typeof req.body.name === 'string') {
        if (req.body.name.trim().length === 0 || req.body.name.length > MAX_NAME_LENGTH) {
            return res.status(400).json({ error: 'Invalid name.' });
        }
        update.name = req.body.name.trim();
    }
    if (typeof req.body.description === 'string') {
        if (req.body.description.length > MAX_DESCRIPTION_LENGTH) {
            return res.status(400).json({ error: 'Description too long.' });
        }
        update.description = req.body.description.trim() || null;
    }
    if (req.body.stops !== undefined) {
        if (!Array.isArray(req.body.stops) || req.body.stops.length === 0) {
            return res.status(400).json({ error: 'Stops must be a non-empty array.' });
        }
        update.stops = req.body.stops;
    }
    if (req.body.geometry !== undefined) {
        const err = validateRoutePayload({ name: 'x', geometry: req.body.geometry, stops: req.body.stops || [{}] });
        if (err && !err.startsWith('At least')) {
            return res.status(400).json({ error: err });
        }
        const newPointCount = req.body.geometry.route.length;

        // Re-check per-user point cap if size changed.
        const { data: existing } = await supabaseUser
            .from('user_routes')
            .select('id, point_count')
            .eq('user_id', req.userId);
        const otherSum = (existing || []).filter(r => r.id !== id).reduce((s, r) => s + (r.point_count || 0), 0);
        if (otherSum + newPointCount > MAX_POINTS_PER_USER) {
            return res.status(403).json({ error: `Point quota exceeded (${otherSum + newPointCount} / ${MAX_POINTS_PER_USER}).` });
        }

        update.geometry = req.body.geometry;
        update.point_count = newPointCount;
    }
    update.updated_at = new Date().toISOString();

    const { data, error } = await supabaseUser
        .from('user_routes')
        .update(update)
        .eq('id', id)
        .eq('user_id', req.userId)
        .select()
        .single();

    if (error || !data) return res.status(404).json({ error: error?.message || 'Route not found.' });

    res.set('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    res.json(data);
};

// GET /user-routes/shared/:id — unauthenticated; UUID is the share token.
// Service-role client bypasses RLS; response strips user_id.
export const getSharedUserRoute = async (req, res) => {
    const { id } = req.params;

    const { data, error } = await supabase
        .from('user_routes')
        .select('id, name, description, osm_ref, osm_relation_id, geometry, stops, point_count, country, total_plays, monthly_plays, created_at, updated_at')
        .eq('id', id)
        .single();

    if (error || !data) return res.status(404).json({ error: 'Route not found.' });

    res.set('Cache-Control', 'public, max-age=60');
    res.json(data);
};

// DELETE /user-routes/:id
export const deleteUserRoute = async (req, res) => {
    const { id } = req.params;
    const supabaseUser = getSupabaseForToken(req.authToken);

    const { error } = await supabaseUser
        .from('user_routes')
        .delete()
        .eq('id', id)
        .eq('user_id', req.userId);

    if (error) return res.status(500).json({ error: error.message });
    res.status(204).end();
};
