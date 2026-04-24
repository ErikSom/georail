import express from 'express';
import { getMyProfile } from '../controllers/user.js';
import { startJourneySession, reportStationArrival, getUserStats, getJourneyHistory, toggleFavoriteRoute, getFavoriteRoutes, getActiveJourneySession, discardActiveJourneySession } from '../controllers/journey.js';
import { authenticateAndAuthorize, authenticateOnly } from '../middleware/auth.js';

const router = express.Router();

// Profile needs authenticateOnly — it's used to check if the user is premium
router.get('/my', authenticateOnly, getMyProfile);
router.get('/stats', authenticateAndAuthorize, getUserStats);
router.post('/journey/start', authenticateAndAuthorize, startJourneySession);
router.get('/journey/active', authenticateAndAuthorize, getActiveJourneySession);
router.post('/journey/discard', authenticateAndAuthorize, discardActiveJourneySession);
router.post('/journey/station', authenticateAndAuthorize, reportStationArrival);
router.get('/journey/history', authenticateAndAuthorize, getJourneyHistory);
router.get('/journey/favorites', authenticateAndAuthorize, getFavoriteRoutes);
router.post('/journey/favorite', authenticateAndAuthorize, toggleFavoriteRoute);

export default router;