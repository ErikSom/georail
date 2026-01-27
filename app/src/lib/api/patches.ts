import { supabase } from '../Supabase';
import type { Patch, PatchWithData, SubmitPatchInput } from '../types/Patch';

const API_BASE = `${import.meta.env.PUBLIC_GEORAIL_URL}/patches`;

/**
 * Helper to get the current session token for the Authorization header
 */
async function getAuthHeader() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('User is not authenticated');
    return { 'Authorization': `Bearer ${session.access_token}` };
}

export interface PatchWithProfile extends Patch {
    profiles?: {
        username?: string;
    } | null;
}

/**
 * Fetch all patches for the current user
 */
export async function fetchPatches(statusFilter?: Patch['status']): Promise<Patch[]> {
    const headers = await getAuthHeader();
    const url = new URL(`${API_BASE}/my`);
    if (statusFilter) url.searchParams.append('status', statusFilter);

    const response = await fetch(url.toString(), { headers });
    if (!response.ok) throw new Error('Failed to fetch user patches');

    return await response.json();
}

/**
 * Fetch all patches (for moderators)
 */
export async function fetchAllPatches(statusFilter?: Patch['status']): Promise<PatchWithProfile[]> {
    const headers = await getAuthHeader();
    const url = new URL(`${API_BASE}/all`);
    if (statusFilter) url.searchParams.append('status', statusFilter);

    const response = await fetch(url.toString(), { headers });
    if (!response.ok) throw new Error('Failed to fetch all patches');

    return await response.json();
}

/**
 * Submit a new patch or update an existing one
 */
export async function submitPatch(input: SubmitPatchInput): Promise<{ success: boolean; patchId: number }> {
    const headers = await getAuthHeader();

    const response = await fetch(`${API_BASE}/submit`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
    });

    if (!response.ok) throw new Error('Failed to submit patch');
    return await response.json();
}

/**
 * Approve a patch (moderator only)
 */
export async function approvePatch(patchId: number): Promise<void> {
    const headers = await getAuthHeader();

    const response = await fetch(`${API_BASE}/approve`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ patchId })
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to approve patch');
    }
}

/**
 * Update status (cancel, reopen, decline)
 */
export async function updatePatchStatus(patchId: number, status: Patch['status'], reason?: string): Promise<void> {
    const headers = await getAuthHeader();

    const response = await fetch(`${API_BASE}/status`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ patchId, status, reason })
    });

    if (!response.ok) throw new Error(`Failed to update patch status to ${status}`);
}

/**
 * Delete a patch (editing patches only)
 */
export async function deletePatch(patchId: number): Promise<void> {
    const headers = await getAuthHeader();

    const response = await fetch(`${API_BASE}/${patchId}`, {
        method: 'DELETE',
        headers,
    });

    if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.error || 'Failed to delete patch');
    }
}

/**
 * Re-mapped helper functions to use the new generic status handler
 */
export const cancelPatch = (patchId: number) => updatePatchStatus(patchId, 'editing');
export const submitPatchForReview = (patchId: number) => updatePatchStatus(patchId, 'pending');
export const reopenPatch = (patchId: number) => updatePatchStatus(patchId, 'editing');
export const declinePatch = (patchId: number, reason?: string) => updatePatchStatus(patchId, 'declined', reason);

/**
 * Get patch count by status for the current user
 */
export async function getPatchStats(): Promise<{ pending: number; approved: number; declined: number }> {
    const patches = await fetchPatches();

    const stats = { pending: 0, approved: 0, declined: 0 };
    patches.forEach((patch) => {
        if (patch.status === 'pending' || patch.status === 'approved' || patch.status === 'declined') {
            stats[patch.status]++;
        }
    });

    return stats;
}

/**
 * Fetch a single patch by ID with its data via the server
 */
export async function fetchPatchWithData(patchId: number, bypassOwnerCheck: boolean = false): Promise<PatchWithData | null> {
    const headers = await getAuthHeader();
    const url = new URL(`${API_BASE}/${patchId}`);
    if (bypassOwnerCheck) url.searchParams.set('bypassOwnerCheck', 'true');

    const response = await fetch(url.toString(), { headers });
    if (response.status === 404) return null;
    if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.error || 'Failed to fetch patch');
    }

    return await response.json();
}
