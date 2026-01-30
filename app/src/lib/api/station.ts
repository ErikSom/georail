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

export const fetchStationDepartures = async (stationCode: string, dateTime?: string) => {
    const url = new URL(`${import.meta.env.PUBLIC_GEORAIL_URL}/stations/departures`);
    url.searchParams.append('station', stationCode);
    if (dateTime) {
        url.searchParams.append('dateTime', dateTime);
    }

    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    if (sessionError || !session) {
        return null;
    }

    const response = await fetch(url.toString(), {
        headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json'
        }
    });

    if (!response.ok) {
        throw new Error('Could not fetch station departures');
    }

    return await response.json();
};

export const fetchJourney = async (train: string, dateTime?: string) => {
    const url = new URL(`${import.meta.env.PUBLIC_GEORAIL_URL}/stations/journey`);
    url.searchParams.append('train', train);
    if (dateTime) {
        url.searchParams.append('dateTime', dateTime);
    }

    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    if (sessionError || !session) {
        return null;
    }

    const response = await fetch(url.toString(), {
        headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json'
        }
    });

    if (!response.ok) {
        throw new Error('Could not fetch journey');
    }

    return await response.json();
};

if (typeof window !== 'undefined') {
    (window as any).fetchStationDepartures = fetchStationDepartures;
    (window as any).fetchJourney = fetchJourney;
}