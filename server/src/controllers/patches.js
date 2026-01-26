import { supabase } from '../supabase.js';

// GET /navi/patches/my
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

// GET /navi/patches/all (Moderator view)
export const getAllPatches = async (req, res) => {
    const { status } = req.query;
    let query = supabase.from('rail_patches').select('*, profiles(username)').neq('status', 'editing');

    if (status) query = query.eq('status', status);

    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });

    // Moderators need the absolute latest data; prevent all caching
    res.set('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    res.json(data);
};

// POST /navi/patches/submit
export const submitPatch = async (req, res) => {
    const { data: patch_data, patchId, fromStation, fromTrack, toStation, toTrack, description } = req.body;

    const { data, error } = await supabase.rpc('submit_patch', {
        patch_data,
        patch_id_to_update: patchId || null,
        p_from_station: fromStation || null,
        p_from_track: fromTrack || null,
        p_to_station: toStation || null,
        p_to_track: toTrack || null,
        p_description: description || null
    });

    if (error) return res.status(500).json({ error: error.message });

    // Mutations should generally not be cached
    res.set('Cache-Control', 'no-store');
    res.json(data);
};

// POST /navi/patches/approve
export const approvePatch = async (req, res) => {
    const { patchId } = req.body;
    const { data, error } = await supabase.rpc('approve_patch', { approved_patch_id: patchId });

    if (error) return res.status(500).json({ error: error.message });

    res.set('Cache-Control', 'no-store');
    res.json(data);
};

// PATCH /navi/patches/status (Generic handler for decline, cancel, reopen)
export const updatePatchStatus = async (req, res) => {
    const { patchId, status, reason } = req.body;
    const updateData = { status, reviewed_at: new Date().toISOString() };

    if (reason) updateData.decline_reason = reason;

    const { error } = await supabase
        .from('rail_patches')
        .update(updateData)
        .eq('id', patchId)
        .eq('user_id', req.userId);

    if (error) return res.status(500).json({ error: error.message });

    res.set('Cache-Control', 'no-store');
    res.json({ success: true });
};