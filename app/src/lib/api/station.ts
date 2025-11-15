import { supabase } from '../Supabase';

export interface StationTrackInfo {
    name: string;
    tracks: string[] | null;
}

export const fetchAllStations = async (): Promise<StationTrackInfo[]> => {
    const { data, error } = await supabase.rpc('get_all_stations_with_tracks');

    if (error) {
        console.error('Error fetching station list:', error);
        throw new Error('Could not fetch station list');
    }

    return data || [];
};