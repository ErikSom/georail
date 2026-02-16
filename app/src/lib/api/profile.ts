import type { Session } from '@supabase/supabase-js';
import { supabase } from '../Supabase';

export type UserRole = 'user' | 'editor' | 'moderator';

export interface UserProfile {
    id: string;
    username?: string;
    role: UserRole;
    nodes_edited: number;
    nodes_reviewed: number;
    total_km: number;
}

const API_URL = `${import.meta.env.PUBLIC_GEORAIL_URL}/user/my`;

// In-memory cache for the current user's profile
let cachedProfile: UserProfile | null = null;

/**
 * Fetch the current user's profile from the Fly.io server
 */
export async function fetchUserProfile(): Promise<UserProfile | null> {
    // Return cached profile if available to avoid unnecessary network calls
    if (cachedProfile) {
        return cachedProfile;
    }

    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    if (sessionError || !session) {
        return null;
    }

    return fetchUserProfileWithSession(session);
}

async function fetchUserProfileWithSession(session: Session): Promise<UserProfile | null> {
    try {
        const response = await fetch(API_URL, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${session.access_token}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            if (response.status === 404) console.error('Profile not found on server');
            return null;
        }

        const data = await response.json();

        cachedProfile = {
            id: data.id,
            username: data.username,
            role: (data.role as UserRole) || 'user',
            nodes_edited: data.nodes_edited || 0,
            nodes_reviewed: data.nodes_reviewed || 0,
            total_km: data.total_km || 0
        };

        return cachedProfile;
    } catch (error) {
        console.error('Error fetching user profile from server:', error);
        return null;
    }
}

/**
 * Get the current user's role (fetches profile if not cached)
 */
export async function fetchUserRole(): Promise<UserRole> {
    const profile = await fetchUserProfile();
    return profile?.role || 'user';
}

/**
 * Clear the cached profile (call on logout)
 */
export function clearProfileCache(): void {
    cachedProfile = null;
}

/**
 * Get the cached profile without fetching (returns null if not cached)
 */
export function getCachedProfile(): UserProfile | null {
    return cachedProfile;
}

// Listen for auth state changes to keep the cache in sync
supabase.auth.onAuthStateChange(async (event) => {
    if (event === 'SIGNED_OUT') {
        clearProfileCache();
    }
});

// Avoid awaiting Supabase auth methods inside the auth state callback.
// Supabase may await callbacks while holding an internal lock; re-entering
// auth methods there can deadlock and freeze the UI.
supabase.auth.onAuthStateChange((event, session) => {
    if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session) {
        clearProfileCache();
        // Defer the profile fetch so the auth lock can be released first.
        queueMicrotask(() => {
            void fetchUserProfileWithSession(session);
        });
    }
});
