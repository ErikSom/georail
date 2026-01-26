// server/src/controllers/departures.js
import axios from 'axios';
import { supabase } from '../supabase.js';

const NS_API_URL = 'https://gateway.api.ns.nl/reisinformatie-api/api/v2/departures';

export const getStationDepartures = async (req, res) => {
    const { station_name, dateTime } = req.query;

    if (!station_name) {
        return res.status(400).json({ error: 'Missing station_name parameter.' });
    }

    try {
        // 1. Find the station code from your database
        const { data: station, error: dbError } = await supabase
            .from('stations')
            .select('ref, name')
            .eq('name', station_name)
            .limit(1)
            .single();

        if (dbError || !station) {
            return res.status(404).json({ error: `Station ${station_name} not found in database.` });
        }

        // 2. Query the NS API using the 'ref' (station code)
        const nsResponse = await axios.get(NS_API_URL, {
            headers: {
                'Ocp-Apim-Subscription-Key': process.env.NS_API_KEY
            },
            params: {
                station: station.ref,
                dateTime: dateTime // Optional: ISO8601 string
            }
        });

        // 3. Return the payload
        res.json({
            station: station.name,
            code: station.ref,
            departures: nsResponse.data.payload.departures
        });

    } catch (error) {
        console.error('NS API Error:', error.message);
        const status = error.response?.status || 500;
        const message = error.response?.data?.message || 'Failed to fetch departures';
        res.status(status).json({ error: message });
    }
};