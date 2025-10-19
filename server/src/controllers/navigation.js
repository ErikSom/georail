import { supabase } from '../supabase.js';

async function getConfig() {
    const { data, error } = await supabase
        .from('config')
        .select()
        .single();

    if (error) throw error;
    return data;
}

export const getAltitudes = async (req, res) => {
    try {
        // cache for 1 hour in browser, 1 year in CDN
        res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=31536000');

        const config = await getConfig();

        const { data: fileData, error: storageError } = await supabase
            .storage
            .from('data')
            .download(`${config.altitude_data}.json`);

        if (storageError) throw storageError;

        const json = JSON.parse(await fileData.text());
        res.json(json);

    } catch (error) {
        res.setHeader('Cache-Control', 'no-store');
        res.status(500).json({ error: error.message });
    }
}



const findRoute = async (req, res) => {
    const { start_lon, start_lat, end_lon, end_lat } = req.query;

    // 1. Call the database function
    const { data, error } = await supabase.rpc('find_rail_route', {
        start_lon: parseFloat(start_lon),
        start_lat: parseFloat(start_lat),
        end_lon: parseFloat(end_lon),
        end_lat: parseFloat(end_lat)
    });

    if (error) {
        console.error(error);
        return res.status(500).json({ error: error.message });
    }

    // 2. Return the resulting GeoJSON
    res.json({
        type: "Feature",
        geometry: data, // 'data' is the GeoJSON geometry from the function
        properties: {
            start: [start_lon, start_lat],
            end: [end_lon, end_lat]
        }
    });
};

export const findRouteByName = async (req, res) => {
    const { from_station, from_track, to_station, to_track } = req.query;

    if (!from_station || !to_station) {
        return res.status(400).json({ error: 'Missing from_station or to_station query parameter.' });
    }

    // === STEP 1: Find the stations in the 'stations' table ===

    // Build the query for the START station
    let startQuery = supabase
        .from('stations')
        .select('geom, name, ref') // Select geom, name, and ref (track)
        .eq('name', from_station);

    // Add the track number to the query if it was provided
    if (from_track) {
        startQuery = startQuery.eq('ref', from_track);
    }

    // Build the query for the END station
    let endQuery = supabase
        .from('stations')
        .select('geom, name, ref')
        .eq('name', to_station);

    // Add the track number to the query if it was provided
    if (to_track) {
        endQuery = endQuery.eq('ref', to_track);
    }

    // --- Execute the queries ---
    const [
        { data: startStations, error: startError },
        { data: endStations, error: endError }
    ] = await Promise.all([
        startQuery.limit(1), // Get the first match
        endQuery.limit(1)    // Get the first match
    ]);

    // --- Handle errors for station finding ---
    if (startError) return res.status(500).json({ error: `Start station query error: ${startError.message}` });
    if (endError) return res.status(500).json({ error: `End station query error: ${endError.message}` });
    if (!startStations || startStations.length === 0) {
        return res.status(404).json({ error: `Could not find start station: ${from_station} (Track: ${from_track || 'any'})` });
    }
    if (!endStations || endStations.length === 0) {
        return res.status(404).json({ error: `Could not find end station: ${to_station} (Track: ${to_track || 'any'})` });
    }

    // Get the first station that matched (and its coordinates)
    const startStation = startStations[0];
    const endStation = endStations[0];

    const startCoords = startStation.geom.coordinates;
    const endCoords = endStation.geom.coordinates;

    // === STEP 2: Call the 'find_rail_route' function with the coordinates ===

    const { data: route, error: routeError } = await supabase.rpc('find_rail_route', {
        start_lon: startCoords[0],
        start_lat: startCoords[1],
        end_lon: endCoords[0],
        end_lat: endCoords[1]
    });

    // --- Handle errors for pathfinding ---
    if (routeError) {
        return res.status(500).json({ error: `Route finding error: ${routeError.message}` });
    }

    if (!route) {
        // This is important! If pgr_dijkstra finds no path, it returns NULL.
        return res.status(404).json({
            error: 'No path found between the selected stations.',
            from: startStation,
            to: endStation
        });
    }

    // === SUCCESS! Return the GeoJSON route ===

    res.json({
        type: "Feature",
        geometry: route, // The route geometry (a LineString)
        properties: {
            from_station: startStation.name,
            from_track: startStation.ref,
            to_station: endStation.name,
            to_track: endStation.ref
        }
    });
};
