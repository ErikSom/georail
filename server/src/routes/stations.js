import express from 'express';

import rateLimit from 'express-rate-limit';
import { authenticateAndAuthorize } from '../middleware/auth.js';

import { getAllStations } from '../controllers/stations.js';
import { getStationDepartures, getJourney } from '../controllers/departures.js';

const staticLimiter = rateLimit({
    windowMs: 1000, // 1 second
    max: 10,
    message: 'Too many requests.',
    // identify users by their real IP behind Cloudflare
    keyGenerator: (req) => {
        return req.headers['cf-connecting-ip'] || req.ip;
    },
    // ensures the limiter handles proxy headers correctly
    validate: { trustProxy: true }
});

const router = express.Router();

router.get('/', staticLimiter, getAllStations);

router.get('/departures', staticLimiter, authenticateAndAuthorize, getStationDepartures);

router.get('/journey', staticLimiter, authenticateAndAuthorize, getJourney);

export default router;