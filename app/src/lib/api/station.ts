import { supabase } from '../Supabase';

export interface StationTrackInfo {
    name: string;
    code: string;
    tracks: string[] | null;
}

export interface RouteStation {
    uicCode: string;
    mediumName: string;
}

export interface Product {
    number: string;
    categoryCode: string;
    shortCategoryName: string;
    longCategoryName: string;
}

export interface Departure {
    direction: string;
    name: string;
    plannedDateTime: string;
    plannedTimeZoneOffset?: number;
    actualDateTime?: string;
    actualTimeZoneOffset?: number;
    plannedTrack?: string;
    actualTrack?: string;
    product: Product;
    trainCategory: string;
    cancelled: boolean;
    journeyDetailRef?: string;
    routeStations: RouteStation[];
    messages: Array<{ message: string; style: string }>;
    departureStatus: 'ON_STATION' | 'INCOMING' | 'DEPARTED' | 'UNKNOWN';
}

export interface DeparturesResponse {
    code: string;
    departures: Departure[];
}

export interface ArrivalOrDeparture {
    product: Product;
    plannedTime?: string;
    actualTime?: string;
    delayInSeconds?: number;
    plannedTrack?: string;
    actualTrack?: string;
    cancelled: boolean;
}

export interface JourneyStop {
    id: string;
    stop: {
        name: string;
        uicCode: string;
        countryCode: string;
        lat: number;
        lng: number;
    };
    previousStopId: string[];
    nextStopId: string[];
    destination?: string;
    status?: 'ORIGIN' | 'SPLIT' | 'STOP' | 'PASSING' | 'COMBINE' | 'DESTINATION' | 'STOP_CHANGED_ORIGIN' | 'STOP_CHANGED_DESTINATION';
    arrivals: ArrivalOrDeparture[];
    departures: ArrivalOrDeparture[];
}

export interface Journey {
    notes: Array<{ value?: string }>;
    productNumbers: string[];
    stops: JourneyStop[];
    allowCrowdReporting: boolean;
    source: string;
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