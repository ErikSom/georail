import express from 'express';
import { authenticateOnly } from '../middleware/auth.js';
import { verifyStripeWebhook, verifyPatreonWebhook } from '../middleware/webhookAuth.js';
import { createCheckoutSession, createPortalSession, handleStripeWebhook } from '../controllers/stripe.js';
import { connectDiscord, discordCallback } from '../controllers/discord.js';
import { connectPatreon, patreonCallback, handlePatreonWebhook } from '../controllers/patreon.js';
import { getSubscriptionStatus } from '../controllers/subscription.js';

const router = express.Router();

// Stripe — checkout needs authenticateOnly (user isn't premium yet)
router.post('/stripe/checkout', authenticateOnly, createCheckoutSession);
router.post('/stripe/portal', authenticateOnly, createPortalSession);
// Stripe webhook uses raw body — parsed at the route level, not here.
// The raw body middleware is applied in server.js before express.json().
router.post('/stripe/webhook', verifyStripeWebhook, handleStripeWebhook);

// Discord OAuth — user may not be premium yet when linking
router.get('/discord/connect', authenticateOnly, connectDiscord);
router.get('/discord/callback', discordCallback);

// Patreon OAuth — user may not be premium yet when linking
router.get('/patreon/connect', authenticateOnly, connectPatreon);
router.get('/patreon/callback', patreonCallback);
// Patreon webhook uses raw body (same as Stripe)
router.post('/patreon/webhook', verifyPatreonWebhook, handlePatreonWebhook);

// Status — needs to work for non-premium users too (account page)
router.get('/status', authenticateOnly, getSubscriptionStatus);

export default router;
