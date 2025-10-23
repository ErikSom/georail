import express from 'express';

import { tileLimiter } from '../middleware/limit.js';
import { authenticateAndAuthorize } from '../middleware/auth.js';

import { findRouteByName } from '../controllers/navigation.js';

const router = express.Router();

router.get('/route', tileLimiter, authenticateAndAuthorize, findRouteByName);

export default router;
