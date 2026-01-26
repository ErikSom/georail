import express from 'express';

import rateLimit from 'express-rate-limit';

import { getAllStations } from '../controllers/stations.js';
// import { getStationDepartures } from '../controllers/departures.js';

const staticLimiter = rateLimit({
    windowMs: 1000,
    max: 10,
    message: 'Too many requests.'
});

const router = express.Router();

router.get('/', staticLimiter, getAllStations);

// Live NS data - No cache
// router.get('/:name/departures', authenticateAndAuthorize, getStationDepartures);

export default router;