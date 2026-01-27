import { supabase } from '../supabase.js';

export const getMyProfile = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('profiles')
            .select('id, username, role')
            .eq('id', req.userId)
            .single();

        if (error || !data) {
            return res.status(404).json({ error: 'Profile not found' });
        }

        // Avoid caching user-specific responses at any shared layer.
        res.set('Cache-Control', 'private, no-cache, no-store, must-revalidate');

        res.json({
            id: data.id,
            username: data.username,
            role: data.role || 'user'
        });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};
