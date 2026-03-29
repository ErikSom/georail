import { supabase } from '../supabase.js';
import { grantDiscordRole, revokeDiscordRole } from '../lib/discord-bot.js';

export async function activatePremium(userId, source, rawEvent = null) {
	const { data: profile, error: fetchError } = await supabase
		.from('profiles')
		.select('discord_user_id')
		.eq('id', userId)
		.single();

	if (fetchError) {
		console.error(`Failed to fetch profile for ${userId}:`, fetchError.message);
		return;
	}

	const { error } = await supabase
		.from('profiles')
		.update({
			is_premium: true,
			premium_source: source
		})
		.eq('id', userId);

	if (error) {
		console.error(`Failed to activate premium for ${userId}:`, error.message);
		return;
	}

	// Log the event
	await supabase.from('subscription_events').insert({
		user_id: userId,
		source,
		event_type: 'activated',
		raw_event: rawEvent
	});

	// Sync Discord role if linked
	if (profile?.discord_user_id) {
		await grantDiscordRole(profile.discord_user_id, source);
	}
}

export async function deactivatePremium(userId, source, rawEvent = null) {
	const { data: profile, error: fetchError } = await supabase
		.from('profiles')
		.select('discord_user_id')
		.eq('id', userId)
		.single();

	if (fetchError) {
		console.error(`Failed to fetch profile for ${userId}:`, fetchError.message);
		return;
	}

	const { error } = await supabase
		.from('profiles')
		.update({
			is_premium: false,
			premium_source: null,
			premium_until: null
		})
		.eq('id', userId);

	if (error) {
		console.error(`Failed to deactivate premium for ${userId}:`, error.message);
		return;
	}

	// Log the event
	await supabase.from('subscription_events').insert({
		user_id: userId,
		source,
		event_type: 'cancelled',
		raw_event: rawEvent
	});

	// Revoke Discord role if linked
	if (profile?.discord_user_id) {
		await revokeDiscordRole(profile.discord_user_id);
	}
}

export async function updatePremiumUntil(userId, premiumUntil) {
	await supabase
		.from('profiles')
		.update({ premium_until: new Date(premiumUntil * 1000).toISOString() })
		.eq('id', userId);
}

export const getSubscriptionStatus = async (req, res) => {
	try {
		const { data, error } = await supabase
			.from('profiles')
			.select('is_premium, premium_source, premium_until, discord_user_id, patreon_user_id')
			.eq('id', req.userId)
			.single();

		if (error || !data) {
			return res.status(404).json({ error: 'Profile not found' });
		}

		res.json({
			is_premium: data.is_premium,
			premium_source: data.premium_source,
			premium_until: data.premium_until,
			discord_linked: !!data.discord_user_id,
			patreon_linked: !!data.patreon_user_id
		});
	} catch (error) {
		console.error('Error fetching subscription status:', error);
		res.status(500).json({ error: 'Server error' });
	}
};
