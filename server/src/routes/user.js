import express from 'express';
import { getMyProfile } from '../controllers/user.js';
import { startJourneySession, reportStationArrival, getUserStats } from '../controllers/journey.js';
import { authenticateAndAuthorize } from '../middleware/auth.js';

const router = express.Router();

router.get('/my', authenticateAndAuthorize, getMyProfile);
router.get('/stats', authenticateAndAuthorize, getUserStats);
router.post('/journey/start', authenticateAndAuthorize, startJourneySession);
router.post('/journey/station', authenticateAndAuthorize, reportStationArrival);

export default router;