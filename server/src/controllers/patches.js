import { supabase, getSupabaseForToken } from '../supabase.js';

// GET /patches/:id
export const getPatchWithData = async (req, res) => {
    const { id } = req.params;
    const bypassOwnerCheck = req.query.bypassOwnerCheck === 'true';
    const supabaseUser = getSupabaseForToken(req.authToken);

    let allowBypass = false;
    if (bypassOwnerCheck) {
        const { data: profile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', req.userId)
            .single();

        allowBypass = profile?.role === 'moderator';
        if (!allowBypass) {
            return res.status(403).json({ error: 'Forbidden' });
        }
    }

    let patchQuery = supabaseUser.from('rail_patches').select('*').eq('id', id);
    if (!allowBypass) {
        patchQuery = patchQuery.eq('user_id', req.userId);
    }

    const { data: patch, error: patchError } = await patchQuery.single();
    if (patchError || !patch) {
        return res.status(404).json({ error: 'Patch not found' });
    }

    const { data: dataPoints, error: dataError } = await supabaseUser
        .from('rail_patch_data')
        .select('*')
        .eq('patch_id', id)
        .order('segment_id', { ascending: true })
        .order('point_index', { ascending: true });

    if (dataError) {
        return res.status(500).json({ error: dataError.message });
    }

    res.set('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    res.json({ ...patch, data: dataPoints });
};

// GET /patches/my
export const getMyPatches = async (req, res) => {
    const { status } = req.query;
    let query = supabase.from('rail_patches').select('*').eq('user_id', req.userId);

    if (status) query = query.eq('status', status);

    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });

    // Ensure private data is never cached by Cloudflare or shared caches
    res.set('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    res.json(data);
};

// GET /patches/all (Moderator view)
export const getAllPatches = async (req, res) => {
    const { status } = req.query;

    // Service-role queries bypass RLS, so enforce moderator access here.
    const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', req.userId)
        .single();

    if (profileError || profile?.role !== 'moderator') {
        return res.status(403).json({ error: 'Forbidden' });
    }

    let query = supabase.from('rail_patches').select('*, profiles(username)').neq('status', 'editing');

    if (status) query = query.eq('status', status);

    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });

    // Moderators need the absolute latest data; prevent all caching
    res.set('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    res.json(data);
};

// POST /patches/submit
export const submitPatch = async (req, res) => {
    const { data: patch_data, patchId, fromStation, fromTrack, toStation, toTrack, viaStops, description } = req.body;
    const supabaseUser = getSupabaseForToken(req.authToken);

    const { data, error } = await supabaseUser.rpc('submit_patch', {
        patch_data,
        patch_id_to_update: patchId || null,
        p_from_station: fromStation || null,
        p_from_track: fromTrack || null,
        p_to_station: toStation || null,
        p_to_track: toTrack || null,
        p_via_stops: viaStops || null,
        p_description: description || null
    });

    if (error) {
        console.error('submit_patch RPC error:', error);
        return res.status(500).json({ error: error.message });
    }

    // Mutations should generally not be cached
    res.set('Cache-Control', 'no-store');
    // Normalize RPC response keys for the client.
    res.json({
        success: Boolean(data?.success),
        patchId: data?.patch_id ?? patchId ?? null,
    });
};

// POST /patches/approve
export const approvePatch = async (req, res) => {
    const { patchId } = req.body;
    const supabaseUser = getSupabaseForToken(req.authToken);
    const { data, error } = await supabaseUser.rpc('approve_patch', { approved_patch_id: patchId });

    if (error) {
        console.error('approve_patch RPC error:', error);
        return res.status(500).json({ error: error.message });
    }

    res.set('Cache-Control', 'no-store');
    res.json(data);
};

// PATCH /patches/status (Unified handler for Decline, Cancel, Reopen, Submit for Review)
export const updatePatchStatus = async (req, res) => {
    const { patchId, status, reason } = req.body;
    const userId = req.userId;

    // Build the update object
    const updateData = { status };

    // If it's a decline, add review metadata
    if (status === 'declined') {
        updateData.reviewed_at = new Date().toISOString();
        updateData.reviewed_by = userId;
        updateData.decline_reason = reason || null;
    }

    // Basic ownership and transition check
    // In production, you might want to check the CURRENT status before updating
    const { error } = await supabase
        .from('rail_patches')
        .update(updateData)
        .eq('id', patchId)
        .eq('user_id', userId);

    if (error) return res.status(500).json({ error: error.message });

    res.set('Cache-Control', 'no-store');
    res.json({ success: true });
};

// GET /patches/coverage
export const getNetworkCoverage = async (req, res) => {
    try {
        const { data, error } = await supabase.rpc('get_network_coverage');
        if (error) throw error;

        res.set('Cache-Control', 'private, max-age=60');
        res.json(data || { summary: {}, lines: [] });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

// GET /patches/open-routes
export const getOpenRoutes = async (req, res) => {
    try {
        const { limit, line } = req.query;
        const maxResults = Math.min(limit ? parseInt(limit, 10) : 10, 10);

        const { data, error } = await supabase.rpc('find_open_routes', {
            max_results: maxResults,
            line_filter: line || null
        });
        if (error) throw error;

        res.set('Cache-Control', 'private, max-age=60');
        res.json(data || []);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

// DELETE /patches/:id
export const deletePatch = async (req, res) => {
    const { id } = req.params;
    const userId = req.userId; // Provided by your auth middleware

    // 1. Safety Check: Only 'editing' patches can be deleted
    const { data: patch, error: fetchError } = await supabase
        .from('rail_patches')
        .select('status')
        .eq('id', id)
        .eq('user_id', userId)
        .single();

    if (fetchError || !patch) {
        return res.status(404).json({ error: 'Patch not found or unauthorized.' });
    }

    if (patch.status !== 'editing') {
        return res.status(400).json({ error: 'Only patches in editing status can be deleted.' });
    }

    // 2. Delete the associated data first (due to Foreign Key constraints)
    const { error: dataError } = await supabase
        .from('rail_patch_data')
        .delete()
        .eq('patch_id', id);

    if (dataError) return res.status(500).json({ error: dataError.message });

    // 3. Delete the patch record
    const { error: patchError } = await supabase
        .from('rail_patches')
        .delete()
        .eq('id', id)
        .eq('user_id', userId);

    if (patchError) return res.status(500).json({ error: patchError.message });

    res.set('Cache-Control', 'no-store');
    res.json({ success: true, message: 'Patch deleted successfully' });
};
