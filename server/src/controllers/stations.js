import { supabase } from '../supabase.js';

export const getAllStations = async (req, res) => {
    try {
        const { country } = req.query;
        const rpcParams = country ? { p_country: country.toUpperCase() } : {};
        const { data, error } = await supabase.rpc('get_all_stations_with_tracks', rpcParams);
        if (error) throw error;

        // Set caching headers: 10 minutes for browsers, 1 week for CDNs
        res.set('Cache-Control', 'public, s-maxage=604800, max-age=600, must-revalidate');

        res.json(data || []);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};