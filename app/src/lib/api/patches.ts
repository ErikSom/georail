import { supabase } from '../Supabase';
import type { Patch, PatchWithData, PatchData, SubmitPatchInput } from '../types/Patch';

/**
 * Fetch all patches for the current user
 */
export async function fetchPatches(statusFilter?: Patch['status']): Promise<Patch[]> {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    if (sessionError) {
        console.error('Error getting session:', sessionError.message);
        throw new Error('Could not retrieve user session');
    }

    if (!session) {
        throw new Error('User is not authenticated');
    }

    let query = supabase
        .from('rail_patches')
        .select('*')
        .eq('user_id', session.user.id);

    if (statusFilter) {
        query = query.eq('status', statusFilter);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) {
        console.error('Error fetching patches:', error);
        throw new Error('Failed to fetch patches');
    }

    return data as Patch[];
}

export interface PatchWithProfile extends Patch {
    profiles?: {
        username?: string;
    } | null;
}

/**
 * Fetch all patches (for moderators) - excludes editing patches
 */
export async function fetchAllPatches(statusFilter?: Patch['status']): Promise<PatchWithProfile[]> {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    if (sessionError) {
        console.error('Error getting session:', sessionError.message);
        throw new Error('Could not retrieve user session');
    }

    if (!session) {
        throw new Error('User is not authenticated');
    }

    let query = supabase
        .from('rail_patches')
        .select(`
            *,
            profiles (username)
        `)
        .neq('status', 'editing'); // Never show editing patches in moderator mode

    if (statusFilter) {
        query = query.eq('status', statusFilter);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) {
        console.error('Error fetching all patches:', error);
        throw new Error('Failed to fetch patches');
    }

    return data as PatchWithProfile[];
}

/**
 * Approve a patch (moderator only) - calls the approve_patch database function
 */
export async function approvePatch(patchId: number): Promise<void> {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    if (sessionError || !session) {
        throw new Error('User is not authenticated');
    }

    const { data, error } = await supabase.rpc('approve_patch', {
        approved_patch_id: patchId
    });

    if (error) {
        console.error('Error approving patch:', error);
        throw new Error(error.message || 'Failed to approve patch');
    }

    if (!data?.success) {
        throw new Error('Failed to approve patch');
    }
}

/**
 * Decline a patch (moderator only)
 */
export async function declinePatch(patchId: number, reason?: string): Promise<void> {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    if (sessionError || !session) {
        throw new Error('User is not authenticated');
    }

    const { error: updateError } = await supabase
        .from('rail_patches')
        .update({
            status: 'declined',
            reviewed_at: new Date().toISOString(),
            reviewed_by: session.user.id,
            decline_reason: reason || null
        })
        .eq('id', patchId)
        .eq('status', 'pending');

    if (updateError) {
        console.error('Error declining patch:', updateError);
        throw new Error('Failed to decline patch');
    }
}

/**
 * Fetch a single patch by ID with its data
 * @param patchId - The ID of the patch to fetch
 * @param bypassOwnerCheck - If true, allows fetching patches regardless of ownership (for moderators)
 */
export async function fetchPatchWithData(patchId: number, bypassOwnerCheck: boolean = false): Promise<PatchWithData | null> {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    if (sessionError || !session) {
        throw new Error('User is not authenticated');
    }

    // Fetch the patch
    let query = supabase
        .from('rail_patches')
        .select('*')
        .eq('id', patchId);

    // Only filter by user_id if not bypassing owner check
    if (!bypassOwnerCheck) {
        query = query.eq('user_id', session.user.id);
    }

    const { data: patchData, error: patchError } = await query.single();

    if (patchError) {
        console.error('Error fetching patch:', patchError);
        return null;
    }

    // Fetch the patch data
    const { data: dataPoints, error: dataError } = await supabase
        .from('rail_patch_data')
        .select('*')
        .eq('patch_id', patchId)
        .order('segment_id', { ascending: true })
        .order('point_index', { ascending: true });

    if (dataError) {
        console.error('Error fetching patch data:', dataError);
        return null;
    }

    return {
        ...patchData,
        data: dataPoints as PatchData[]
    } as PatchWithData;
}

/**
 * Submit a new patch or update an existing one using the submit_patch function
 */
export async function submitPatch(input: SubmitPatchInput): Promise<{ success: boolean; patchId: number }> {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    if (sessionError || !session) {
        throw new Error('User is not authenticated');
    }

    const { data, error } = await supabase.rpc('submit_patch', {
        patch_data: input.data,
        patch_id_to_update: input.patchId || null,
        p_from_station: input.fromStation || null,
        p_from_track: input.fromTrack || null,
        p_to_station: input.toStation || null,
        p_to_track: input.toTrack || null,
        p_description: input.description || null
    });

    if (error) {
        console.error('Error submitting patch:', error);
        throw new Error('Failed to submit patch');
    }

    return {
        success: data.success,
        patchId: data.patch_id
    };
}

/**
 * Delete a patch (only if status is 'pending')
 */
export async function deletePatch(patchId: number): Promise<void> {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    if (sessionError || !session) {
        throw new Error('User is not authenticated');
    }

    // First check if the patch is pending
    const { data: patch, error: fetchError } = await supabase
        .from('rail_patches')
        .select('status')
        .eq('id', patchId)
        .eq('user_id', session.user.id)
        .single();

    if (fetchError || !patch) {
        throw new Error('Patch not found');
    }

    if (patch.status !== 'editing') {
        throw new Error('Can only delete editing patches');
    }

    // Delete patch data first (foreign key constraint)
    const { error: dataError } = await supabase
        .from('rail_patch_data')
        .delete()
        .eq('patch_id', patchId);

    if (dataError) {
        console.error('Error deleting patch data:', dataError);
        throw new Error('Failed to delete patch data');
    }

    // Then delete the patch
    const { error: patchError } = await supabase
        .from('rail_patches')
        .delete()
        .eq('id', patchId)
        .eq('user_id', session.user.id);

    if (patchError) {
        console.error('Error deleting patch:', patchError);
        throw new Error('Failed to delete patch');
    }
}

/**
 * Submit an editing patch (change status to 'pending')
 */
export async function submitPatchForReview(patchId: number): Promise<void> {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    if (sessionError || !session) {
        throw new Error('User is not authenticated');
    }

    // First check if the patch is editing
    const { data: patch, error: fetchError } = await supabase
        .from('rail_patches')
        .select('status')
        .eq('id', patchId)
        .eq('user_id', session.user.id)
        .single();

    if (fetchError || !patch) {
        throw new Error('Patch not found');
    }

    if (patch.status !== 'editing') {
        throw new Error('Can only submit editing patches');
    }

    // Update status to pending
    const { error: updateError } = await supabase
        .from('rail_patches')
        .update({ status: 'pending' })
        .eq('id', patchId)
        .eq('user_id', session.user.id);

    if (updateError) {
        console.error('Error submitting patch:', updateError);
        throw new Error('Failed to submit patch');
    }
}

/**
 * Cancel a pending patch (change status back to 'editing')
 */
export async function cancelPatch(patchId: number): Promise<void> {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    if (sessionError || !session) {
        throw new Error('User is not authenticated');
    }

    // First check if the patch is pending
    const { data: patch, error: fetchError } = await supabase
        .from('rail_patches')
        .select('status')
        .eq('id', patchId)
        .eq('user_id', session.user.id)
        .single();

    if (fetchError || !patch) {
        throw new Error('Patch not found');
    }

    if (patch.status !== 'pending') {
        throw new Error('Can only cancel pending patches');
    }

    // Update status to editing
    const { error: updateError } = await supabase
        .from('rail_patches')
        .update({ status: 'editing' })
        .eq('id', patchId)
        .eq('user_id', session.user.id);

    if (updateError) {
        console.error('Error canceling patch:', updateError);
        throw new Error('Failed to cancel patch');
    }
}

/**
 * Reopen a declined patch (change status back to editing)
 */
export async function reopenPatch(patchId: number): Promise<void> {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    if (sessionError || !session) {
        throw new Error('User is not authenticated');
    }

    // First check if the patch is declined and belongs to user
    const { data: patch, error: fetchError } = await supabase
        .from('rail_patches')
        .select('status')
        .eq('id', patchId)
        .eq('user_id', session.user.id)
        .single();

    if (fetchError || !patch) {
        throw new Error('Patch not found');
    }

    if (patch.status !== 'declined') {
        throw new Error('Can only reopen declined patches');
    }

    // Update status to editing (keep review fields for moderator reference)
    const { error: updateError } = await supabase
        .from('rail_patches')
        .update({
            status: 'editing',
        })
        .eq('id', patchId)
        .eq('user_id', session.user.id);

    if (updateError) {
        console.error('Error reopening patch:', updateError);
        throw new Error('Failed to reopen patch');
    }
}

/**
 * Get patch count by status for the current user
 */
export async function getPatchStats(): Promise<{ pending: number; approved: number; declined: number }> {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    if (sessionError || !session) {
        throw new Error('User is not authenticated');
    }

    const { data, error } = await supabase
        .from('rail_patches')
        .select('status')
        .eq('user_id', session.user.id);

    if (error) {
        console.error('Error fetching patch stats:', error);
        return { pending: 0, approved: 0, declined: 0 };
    }

    const stats = { pending: 0, approved: 0, declined: 0 };
    data.forEach((patch) => {
        stats[patch.status as keyof typeof stats]++;
    });

    return stats;
}
