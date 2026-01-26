import express from 'express';

import rateLimit from 'express-rate-limit';
import { authenticateAndAuthorize } from '../middleware/auth.js';

import { findRouteByName } from '../controllers/navigation.js';

const routeLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 20,
    message: 'Pathfinding limit reached. Please wait a minute.'
});

const router = express.Router();

router.get('/route', routeLimiter, authenticateAndAuthorize, findRouteByName);

export default router;
