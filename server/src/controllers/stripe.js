import Stripe from 'stripe';
import { supabase } from '../supabase.js';
import { activatePremium, deactivatePremium, updatePremiumUntil } from './subscription.js';

const getStripe = () => new Stripe(process.env.STRIPE_SECRET_KEY);

export const createCheckoutSession = async (req, res) => {
	try {
		const stripe = getStripe();

		// Check if user already has a stripe_customer_id
		const { data: profile } = await supabase
			.from('profiles')
			.select('stripe_customer_id')
			.eq('id', req.userId)
			.single();

		const sessionParams = {
			mode: 'subscription',
			line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
			client_reference_id: req.userId,
			success_url: `${process.env.CLIENT_URL}/account?stripe=success`,
			cancel_url: `${process.env.CLIENT_URL}/account?stripe=cancel`
		};

		// Reuse existing Stripe customer if available
		if (profile?.stripe_customer_id) {
			sessionParams.customer = profile.stripe_customer_id;
		}

		const session = await stripe.checkout.sessions.create(sessionParams);
		res.json({ url: session.url });
	} catch (error) {
		console.error('Error creating checkout session:', error);
		res.status(500).json({ error: 'Failed to create checkout session' });
	}
};

export const createPortalSession = async (req, res) => {
	try {
		const stripe = getStripe();

		const { data: profile } = await supabase
			.from('profiles')
			.select('stripe_customer_id')
			.eq('id', req.userId)
			.single();

		if (!profile?.stripe_customer_id) {
			return res.status(400).json({ error: 'No Stripe customer found' });
		}

		const session = await stripe.billingPortal.sessions.create({
			customer: profile.stripe_customer_id,
			return_url: `${process.env.CLIENT_URL}/account`
		});

		res.json({ url: session.url });
	} catch (error) {
		console.error('Error creating portal session:', error);
		res.status(500).json({ error: 'Failed to create portal session' });
	}
};

export const handleStripeWebhook = async (req, res) => {
	const event = req.stripeEvent;

	try {
		switch (event.type) {
			case 'checkout.session.completed': {
				const session = event.data.object;
				const userId = session.client_reference_id;
				const customerId = session.customer;

				if (!userId) break;

				// Link Stripe customer ID to profile
				await supabase
					.from('profiles')
					.update({ stripe_customer_id: customerId })
					.eq('id', userId);

				await activatePremium(userId, 'stripe', event);
				break;
			}

			case 'customer.subscription.updated': {
				const subscription = event.data.object;
				const customerId = subscription.customer;

				const { data: profile } = await supabase
					.from('profiles')
					.select('id')
					.eq('stripe_customer_id', customerId)
					.single();

				if (!profile) break;

				if (subscription.status === 'active') {
					await activatePremium(profile.id, 'stripe', event);
				}

				// Update period end
				if (subscription.current_period_end) {
					await updatePremiumUntil(profile.id, subscription.current_period_end);
				}
				break;
			}

			case 'customer.subscription.deleted': {
				const subscription = event.data.object;
				const customerId = subscription.customer;

				const { data: profile } = await supabase
					.from('profiles')
					.select('id')
					.eq('stripe_customer_id', customerId)
					.single();

				if (!profile) break;

				await deactivatePremium(profile.id, 'stripe', event);
				break;
			}
		}

		res.json({ received: true });
	} catch (error) {
		console.error('Error handling Stripe webhook:', error);
		res.status(500).json({ error: 'Webhook handler failed' });
	}
};
