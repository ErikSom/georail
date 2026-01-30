import axios from 'axios';

const NS_API_BASE = 'https://gateway.apiportal.ns.nl/reisinformatie-api/api/v2';

export const getStationDepartures = async (req, res) => {

    const { station, dateTime } = req.query;

    if (!station) {
        return res.status(400).json({ error: 'Missing station parameter.' });
    }

    try {
        // [?lang][& station][& uicCode][& dateTime][& maxJourneys]
        const nsResponse = await axios.get(`${NS_API_BASE}/departures`, {
            headers: {
                'Cache-Control': 'no-cache',
                'Ocp-Apim-Subscription-Key': process.env.NS_API_KEY
            },
            params: {
                lang: 'en',
                maxJourneys: 20,
                station,
                dateTime: dateTime // Optional: ISO8601 string
            }
        });

        res.json({
            code: station,
            departures: nsResponse.data.payload.departures
        });

    } catch (error) {
        console.error('NS API Error:', error.message);
        const status = error.response?.status || 500;
        const message = error.response?.data?.message || 'Failed to fetch departures';
        res.status(status).json({ error: message });
    }
};

export const getJourney = async (req, res) => {
    const { train, dateTime } = req.query;

    if (!train) {
        return res.status(400).json({ error: 'Missing train parameter.' });
    }

    try {
        // [?train][& dateTime]
        const nsResponse = await axios.get(`${NS_API_BASE}/journey`, {
            headers: {
                'Cache-Control': 'no-cache',
                'Ocp-Apim-Subscription-Key': process.env.NS_API_KEY
            },
            params: {
                train,
                dateTime // Optional: ISO8601 string
            }
        });

        res.json(nsResponse.data.payload);

    } catch (error) {
        console.error('NS API Error:', error.message);
        const status = error.response?.status || 500;
        const message = error.response?.data?.message || 'Failed to fetch journey';
        res.status(status).json({ error: message });
    }
};