import crypto from 'crypto';
import axios from 'axios';
import { supabase } from '../supabase.js';
import { grantDiscordRole } from '../lib/discord-bot.js';

const DISCORD_API = 'https://discord.com/api/v10';
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// In-memory store for OAuth state nonces
const pendingStates = new Map();

function getStateSecret() {
	// Use a stable secret for HMAC signing
	return process.env.DISCORD_CLIENT_SECRET;
}

function createSignedState(userId) {
	const nonce = crypto.randomUUID();
	const payload = JSON.stringify({ userId, nonce });
	const hmac = crypto.createHmac('sha256', getStateSecret()).update(payload).digest('hex');
	const state = Buffer.from(payload).toString('base64url') + '.' + hmac;

	pendingStates.set(nonce, { userId, expiresAt: Date.now() + STATE_TTL_MS });

	// Cleanup expired states
	for (const [key, val] of pendingStates.entries()) {
		if (Date.now() > val.expiresAt) pendingStates.delete(key);
	}

	return state;
}

function verifyState(state) {
	const [payloadB64, hmac] = state.split('.');
	if (!payloadB64 || !hmac) return null;

	const payload = Buffer.from(payloadB64, 'base64url').toString();
	const expectedHmac = crypto.createHmac('sha256', getStateSecret()).update(payload).digest('hex');

	if (!crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(expectedHmac))) {
		return null;
	}

	const { userId, nonce } = JSON.parse(payload);
	const pending = pendingStates.get(nonce);
	if (!pending || Date.now() > pending.expiresAt || pending.userId !== userId) {
		return null;
	}

	pendingStates.delete(nonce);
	return { userId };
}

export const connectDiscord = async (req, res) => {
	const state = createSignedState(req.userId);
	const clientId = process.env.DISCORD_CLIENT_ID;
	const redirectUri = `${process.env.SERVER_URL || `http://localhost:${process.env.APP_PORT || 3000}`}/subscription/discord/callback`;

	const params = new URLSearchParams({
		client_id: clientId,
		redirect_uri: redirectUri,
		response_type: 'code',
		scope: 'identify',
		state
	});

	res.json({ url: `${DISCORD_API}/oauth2/authorize?${params}` });
};

export const discordCallback = async (req, res) => {
	const { code, state } = req.query;
	const clientUrl = process.env.CLIENT_URL || 'http://localhost:4321';

	if (!code || !state) {
		return res.redirect(`${clientUrl}/account?discord=error`);
	}

	const verified = verifyState(state);
	if (!verified) {
		return res.redirect(`${clientUrl}/account?discord=error`);
	}

	const { userId } = verified;
	const redirectUri = `${process.env.SERVER_URL || `http://localhost:${process.env.APP_PORT || 3000}`}/subscription/discord/callback`;

	try {
		// Exchange code for token
		const tokenResponse = await axios.post(`${DISCORD_API}/oauth2/token`, new URLSearchParams({
			client_id: process.env.DISCORD_CLIENT_ID,
			client_secret: process.env.DISCORD_CLIENT_SECRET,
			grant_type: 'authorization_code',
			code,
			redirect_uri: redirectUri
		}), {
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
		});

		const accessToken = tokenResponse.data.access_token;

		// Get Discord user info
		const userResponse = await axios.get(`${DISCORD_API}/users/@me`, {
			headers: { Authorization: `Bearer ${accessToken}` }
		});

		const discordUserId = userResponse.data.id;

		// Store Discord user ID on profile
		await supabase
			.from('profiles')
			.update({ discord_user_id: discordUserId })
			.eq('id', userId);

		// If user is premium, grant Discord role immediately
		const { data: profile } = await supabase
			.from('profiles')
			.select('is_premium, premium_source')
			.eq('id', userId)
			.single();

		if (profile?.is_premium) {
			await grantDiscordRole(discordUserId, profile.premium_source);
		}

		res.redirect(`${clientUrl}/account?discord=linked`);
	} catch (error) {
		console.error('Discord OAuth error:', error.response?.data || error.message);
		res.redirect(`${clientUrl}/account?discord=error`);
	}
};
