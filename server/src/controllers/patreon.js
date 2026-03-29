import crypto from 'crypto';
import axios from 'axios';
import { supabase } from '../supabase.js';
import { activatePremium, deactivatePremium } from './subscription.js';

const PATREON_API = 'https://www.patreon.com/api/oauth2/v2';
const PATREON_AUTH = 'https://www.patreon.com/oauth2';
const STATE_TTL_MS = 10 * 60 * 1000;

const pendingStates = new Map();

function getStateSecret() {
	return process.env.PATREON_CLIENT_SECRET;
}

function createSignedState(userId) {
	const nonce = crypto.randomUUID();
	const payload = JSON.stringify({ userId, nonce });
	const hmac = crypto.createHmac('sha256', getStateSecret()).update(payload).digest('hex');
	const state = Buffer.from(payload).toString('base64url') + '.' + hmac;

	pendingStates.set(nonce, { userId, expiresAt: Date.now() + STATE_TTL_MS });

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

export const connectPatreon = async (req, res) => {
	const state = createSignedState(req.userId);
	const redirectUri = `${process.env.SERVER_URL || `http://localhost:${process.env.APP_PORT || 3000}`}/subscription/patreon/callback`;

	const params = new URLSearchParams({
		response_type: 'code',
		client_id: process.env.PATREON_CLIENT_ID,
		redirect_uri: redirectUri,
		scope: 'identity identity[email]',
		state
	});

	res.json({ url: `${PATREON_AUTH}/authorize?${params}` });
};

export const patreonCallback = async (req, res) => {
	const { code, state } = req.query;
	const clientUrl = process.env.CLIENT_URL || 'http://localhost:4321';

	if (!code || !state) {
		return res.redirect(`${clientUrl}/account?patreon=error`);
	}

	const verified = verifyState(state);
	if (!verified) {
		return res.redirect(`${clientUrl}/account?patreon=error`);
	}

	const { userId } = verified;
	const redirectUri = `${process.env.SERVER_URL || `http://localhost:${process.env.APP_PORT || 3000}`}/subscription/patreon/callback`;

	try {
		// Exchange code for token
		const tokenResponse = await axios.post(`${PATREON_AUTH}/token`, new URLSearchParams({
			code,
			grant_type: 'authorization_code',
			client_id: process.env.PATREON_CLIENT_ID,
			client_secret: process.env.PATREON_CLIENT_SECRET,
			redirect_uri: redirectUri
		}), {
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
		});

		const accessToken = tokenResponse.data.access_token;

		// Check if user is an active patron of our campaign
		const identityResponse = await axios.get(
			`${PATREON_API}/identity?include=memberships&fields[member]=patron_status,currently_entitled_amount_cents`,
			{ headers: { Authorization: `Bearer ${accessToken}` } }
		);

		const patreonUserId = identityResponse.data.data.id;
		const memberships = identityResponse.data.included || [];

		// Check for active patron status
		const isActivePatron = memberships.some(m =>
			m.type === 'member' &&
			m.attributes?.patron_status === 'active_patron'
		);

		// Store Patreon user ID
		await supabase
			.from('profiles')
			.update({ patreon_user_id: patreonUserId })
			.eq('id', userId);

		if (isActivePatron) {
			await activatePremium(userId, 'patreon');
			res.redirect(`${clientUrl}/account?patreon=success`);
		} else {
			res.redirect(`${clientUrl}/account?patreon=not_patron`);
		}
	} catch (error) {
		console.error('Patreon OAuth error:', error.response?.data || error.message);
		res.redirect(`${clientUrl}/account?patreon=error`);
	}
};

export const handlePatreonWebhook = async (req, res) => {
	const event = req.patreonEvent;
	const trigger = req.headers['x-patreon-event'];

	try {
		const patronData = event.data;
		const patreonUserId = patronData?.relationships?.user?.data?.id;

		if (!patreonUserId) {
			return res.json({ received: true });
		}

		// Find user by patreon_user_id
		const { data: profile } = await supabase
			.from('profiles')
			.select('id')
			.eq('patreon_user_id', patreonUserId)
			.single();

		if (!profile) {
			// User hasn't linked their Patreon yet
			return res.json({ received: true });
		}

		switch (trigger) {
			case 'members:pledge:create':
			case 'members:pledge:update': {
				const status = patronData.attributes?.patron_status;
				if (status === 'active_patron') {
					await activatePremium(profile.id, 'patreon', event);
				}
				break;
			}
			case 'members:pledge:delete': {
				await deactivatePremium(profile.id, 'patreon', event);
				break;
			}
		}

		res.json({ received: true });
	} catch (error) {
		console.error('Error handling Patreon webhook:', error);
		res.status(500).json({ error: 'Webhook handler failed' });
	}
};
