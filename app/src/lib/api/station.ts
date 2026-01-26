import { supabase } from '../Supabase';

export interface StationTrackInfo {
    name: string;
    tracks: string[] | null;
}

export const fetchAllStations = async (): Promise<StationTrackInfo[]> => {
    const url = new URL(`${import.meta.env.PUBLIC_GEORAIL_URL}/stations`);

    const response = await fetch(url.toString());

    if (!response.ok) {
        throw new Error('Could not fetch station list');
    }

    return await response.json();
};