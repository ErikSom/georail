import express from 'express';
import rateLimit from 'express-rate-limit';
import { fetchOverpassRoute } from '../controllers/overpass.js';

const overpassLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: 'Overpass fetch limit reached. Please wait a minute.',
    keyGenerator: (req) => req.headers['cf-connecting-ip'] || req.ip,
    validate: { trustProxy: true },
});

const router = express.Router();

router.get('/route', overpassLimiter, fetchOverpassRoute);

export default router;
