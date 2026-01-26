import express from 'express';
import { getMyProfile } from '../controllers/user.js';
import { authenticateAndAuthorize } from '../middleware/auth.js';

const router = express.Router();

router.get('/my', authenticateAndAuthorize, getMyProfile);

export default router;