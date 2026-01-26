import { supabase } from '../supabase.js';

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

// POST /patches/approve
export const approvePatch = async (req, res) => {
    const { patchId } = req.body;
    const { data, error } = await supabase.rpc('approve_patch', { approved_patch_id: patchId });

    if (error) return res.status(500).json({ error: error.message });

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