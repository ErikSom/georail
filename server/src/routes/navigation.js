import express from 'express';

import rateLimit from 'express-rate-limit';

import { findRouteByName } from '../controllers/navigation.js';

const routeLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    message: 'Pathfinding limit reached. Please wait a minute.',
    keyGenerator: (req) => {
        return req.headers['cf-connecting-ip'] || req.ip;
    },
    validate: { trustProxy: true }
});

const router = express.Router();

router.get('/route', routeLimiter, findRouteByName);

export default router;
