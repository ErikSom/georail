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

export const getTrackNodes = async (req, res) => {
    try {
        const { startStation, endStation } = req.params;

        // Example response format
        const nodes = [
            {
                latitude: 51.5074,
                longitude: -0.1278,
                altitude: 100,
                name: "London Bridge Junction"
            },
            // More nodes...
        ];

        // Here you would:
        // 1. Validate station names
        // 2. Query your database/source for nodes
        // 3. Process the data if needed

        res.json({
            startStation,
            endStation,
            nodes: nodes
        });
    } catch (error) {
        console.error('Error fetching train nodes:', error);
        res.status(500).json({
            error: 'Failed to fetch train nodes',
            message: error.message
        });
    }
};
