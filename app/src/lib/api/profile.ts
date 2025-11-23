import { supabase } from '../Supabase';

export type UserRole = 'user' | 'editor' | 'moderator';

export interface UserProfile {
    id: string;
    username?: string;
    role: UserRole;
}

// In-memory cache for the current user's profile
let cachedProfile: UserProfile | null = null;

/**
 * Fetch the current user's profile
 */
export async function fetchUserProfile(): Promise<UserProfile | null> {
    // Return cached profile if available
    if (cachedProfile) {
        return cachedProfile;
    }

    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    if (sessionError || !session) {
        return null;
    }

    const { data, error } = await supabase
        .from('profiles')
        .select('id, username, role')
        .eq('id', session.user.id)
        .single();

    if (error) {
        console.error('Error fetching user profile:', error);
        return null;
    }

    cachedProfile = {
        id: data.id,
        username: data.username,
        role: (data.role as UserRole) || 'editor'
    };

    return cachedProfile;
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

// Listen for auth state changes to clear cache on logout and fetch on login
supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
        clearProfileCache();
    } else if (event === 'SIGNED_IN') {
        // Fetch profile on login
        fetchUserProfile();
    }
});
