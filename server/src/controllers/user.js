import { supabase } from '../supabase.js';

export const getMyProfile = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('profiles')
            .select('id, username, role, nodes_edited, nodes_reviewed, total_km, is_premium, premium_source, discord_user_id, patreon_user_id')
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
            role: data.role || 'user',
            nodes_edited: data.nodes_edited || 0,
            nodes_reviewed: data.nodes_reviewed || 0,
            total_km: data.total_km || 0,
            is_premium: data.is_premium || false,
            premium_source: data.premium_source || null,
            discord_linked: !!data.discord_user_id,
            patreon_linked: !!data.patreon_user_id
        });
    } catch {
        res.status(500).json({ error: 'Server error' });
    }
};
