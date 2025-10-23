import { supabase } from '../supabase.js';

export const findRouteByName = async (req, res) => {
    const { from_station, from_track, to_station, to_track, editor } = req.query;

    if (!from_station || !to_station) {
        return res.status(400).json({ error: 'Missing from_station or to_station query parameter.' });
    }

    // === STEP 1: Find the stations in the 'stations' table ===
    let startQuery = supabase
        .from('stations')
        .select('geom, name, ref')
        .eq('name', from_station);

    if (from_track) {
        startQuery = startQuery.eq('ref', from_track);
    }

    let endQuery = supabase
        .from('stations')
        .select('geom, name, ref')
        .eq('name', to_station);

    if (to_track) {
        endQuery = endQuery.eq('ref', to_track);
    }

    const [
        { data: startStations, error: startError },
        { data: endStations, error: endError }
    ] = await Promise.all([
        startQuery.limit(1),
        endQuery.limit(1)
    ]);

    if (startError) return res.status(500).json({ error: `Start station query error: ${startError.message}` });
    if (endError) return res.status(500).json({ error: `End station query error: ${endError.message}` });
    if (!startStations || startStations.length === 0) {
        return res.status(404).json({ error: `Could not find start station: ${from_station} (Track: ${from_track || 'any'})` });
    }
    if (!endStations || endStations.length === 0) {
        return res.status(404).json({ error: `Could not find end station: ${to_station} (Track: ${to_track || 'any'})` });
    }

    const startStation = startStations[0];
    const endStation = endStations[0];
    const startCoords = startStation.geom.coordinates;
    const endCoords = endStation.geom.coordinates;

    const isEditorMode = (editor === 'true');

    // === STEP 2: Call the 'find_rail_route' function with all parameters ===
    const { data: route, error: routeError } = await supabase.rpc('find_rail_route', {
        start_lon: startCoords[0],
        start_lat: startCoords[1],
        end_lon: endCoords[0],
        end_lat: endCoords[1],
        editor: isEditorMode
    });

    if (routeError) {
        return res.status(500).json({ error: `Route finding error: ${routeError.message}` });
    }

    if (!route) {
        return res.status(404).json({
            error: 'No path found between the selected stations.',
            from: startStation,
            to: endStation
        });
    }

    // === SUCCESS! Return the JSON ===
    res.json({
        type: "Feature",
        geometry: route,
        properties: {
            from_station: startStation.name,
            from_track: startStation.ref,
            to_station: endStation.name,
            to_track: endStation.ref
        }
    });
};
