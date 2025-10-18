import express from 'express';

import { tileLimiter } from '../middleware/limit.js';
import { authenticateAndAuthorize } from '../middleware/auth.js';

import { getAltitudes, getTrackNodes } from '../controllers/navigation.js';

const router = express.Router();

router.get('/altitude_data', tileLimiter, authenticateAndAuthorize,getAltitudes)
router.get('/:startStation/:endStation',tileLimiter, authenticateAndAuthorize, getTrackNodes);


export default router;
