import express from 'express';

import { tileLimiter } from '../middleware/limit.js';
import { authenticateAndAuthorize } from '../middleware/auth.js';

import { getAltitudes, findRouteByName } from '../controllers/navigation.js';

const router = express.Router();

router.get('/altitude_data', tileLimiter, authenticateAndAuthorize, getAltitudes)
router.get('/route', tileLimiter, authenticateAndAuthorize, findRouteByName);

export default router;
