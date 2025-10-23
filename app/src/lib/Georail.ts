import { supabase } from '../lib/Supabase';

export const fetchRouteByName = async (
    fromStation: string,
    fromTrack: string | null,
    toStation: string,
    toTrack: string | null,
    editor: boolean = false
) => {
    const url = new URL(`${import.meta.env.PUBLIC_GEORAIL_URL}/navi/route`);
    url.searchParams.append('from_station', fromStation);
    if (fromTrack) url.searchParams.append('from_track', fromTrack);
    url.searchParams.append('to_station', toStation);
    if (toTrack) url.searchParams.append('to_track', toTrack);

    if (editor) {
        url.searchParams.append('editor', 'true');
    }

    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    if (sessionError) {
        console.error('Error getting session:', sessionError.message);
        throw new Error('Could not retrieve user session');
    }

    if (!session) {
        console.warn('No active session. User is not authenticated.');
        throw new Error('User is not authenticated');
    }

    const token = session.access_token;

    try {
        const response = await fetch(url.toString(), {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `Server error: ${response.status}`);
        }

        return await response.json();

    } catch (error) {
        console.error('Failed to fetch route:', error);
        throw error;
    }
};