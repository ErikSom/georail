import express from 'express';
import rateLimit from 'express-rate-limit';
import { fetchOverpassRoute, searchOverpassRoutes } from '../controllers/overpass.js';

const overpassLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: 'Overpass fetch limit reached. Please wait a minute.',
    keyGenerator: (req) => req.headers['cf-connecting-ip'] || req.ip,
    validate: { trustProxy: true },
});

// Search is cheaper (tags only) so we allow more requests per minute.
const searchLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: 'Search limit reached. Please wait a minute.',
    keyGenerator: (req) => req.headers['cf-connecting-ip'] || req.ip,
    validate: { trustProxy: true },
});

const router = express.Router();

router.get('/route', overpassLimiter, fetchOverpassRoute);
router.get('/search', searchLimiter, searchOverpassRoutes);

export default router;
