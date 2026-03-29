import Stripe from 'stripe';
import crypto from 'crypto';

let stripe = null;
function getStripe() {
	if (!stripe) stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
	return stripe;
}

export function verifyStripeWebhook(req, res, next) {
	const sig = req.headers['stripe-signature'];
	const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

	if (!sig || !webhookSecret) {
		return res.status(400).json({ error: 'Missing signature or webhook secret' });
	}

	try {
		req.stripeEvent = getStripe().webhooks.constructEvent(req.body, sig, webhookSecret);
		next();
	} catch (error) {
		console.error('Stripe webhook signature verification failed:', error.message);
		return res.status(400).json({ error: 'Invalid signature' });
	}
}

export function verifyPatreonWebhook(req, res, next) {
	const sig = req.headers['x-patreon-signature'];
	const webhookSecret = process.env.PATREON_WEBHOOK_SECRET;

	if (!sig || !webhookSecret) {
		return res.status(400).json({ error: 'Missing signature or webhook secret' });
	}

	const hash = crypto
		.createHmac('md5', webhookSecret)
		.update(req.body)
		.digest('hex');

	if (hash !== sig) {
		console.error('Patreon webhook signature verification failed');
		return res.status(400).json({ error: 'Invalid signature' });
	}

	try {
		req.patreonEvent = JSON.parse(req.body.toString());
		next();
	} catch (error) {
		return res.status(400).json({ error: 'Invalid JSON body' });
	}
}
