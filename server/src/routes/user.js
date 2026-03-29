import express from 'express';
import { getMyProfile } from '../controllers/user.js';
import { startJourneySession, reportStationArrival, getUserStats } from '../controllers/journey.js';
import { authenticateAndAuthorize, authenticateOnly } from '../middleware/auth.js';

const router = express.Router();

// Profile needs authenticateOnly — it's used to check if the user is premium
router.get('/my', authenticateOnly, getMyProfile);
router.get('/stats', authenticateAndAuthorize, getUserStats);
router.post('/journey/start', authenticateAndAuthorize, startJourneySession);
router.post('/journey/station', authenticateAndAuthorize, reportStationArrival);

export default router;