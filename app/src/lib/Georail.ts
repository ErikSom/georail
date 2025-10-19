// Adjust this import path to point to your client-side Supabase instance
import { supabase } from '../lib/Supabase';

export async function fetchAltitudeData() {
    const url = `${import.meta.env.PUBLIC_GEORAIL_URL}/navi/altitude_data`;

    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    if (sessionError) {
        console.error('Error getting session:', sessionError.message);
        throw new Error('Could not retrieve user session');
    }

    if (!session) {
        // This means the user is not logged in.
        // Your server will reject this, so we can stop here.
        console.warn('No active session. User is not authenticated.');
        throw new Error('User is not authenticated');
    }

    const token = session.access_token;

    try {
        const response = await fetch(url, {
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
        console.error('Failed to fetch settings:', error);
        throw error;
    }
}


export const fetchRouteByName = async (fromStation: string, fromTrack: string | null, toStation: string, toTrack: string | null) => {
    const url = new URL(`${import.meta.env.PUBLIC_GEORAIL_URL}/navi/route`);
    url.searchParams.append('from_station', fromStation);
    if (fromTrack) url.searchParams.append('from_track', fromTrack);
    url.searchParams.append('to_station', toStation);
    if (toTrack) url.searchParams.append('to_track', toTrack);

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