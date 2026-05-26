import express from 'express';
import rateLimit from 'express-rate-limit';
import { listConsists, listPositions } from '../controllers/livePositions.js';

const limiter = rateLimit({
    windowMs: 1000,
    max: 10,
    message: 'Too many requests.',
    keyGenerator: (req) => req.headers['cf-connecting-ip'] || req.ip,
    validate: { trustProxy: true },
});

const router = express.Router();

router.get('/', limiter, listPositions);
router.get('/consists', limiter, listConsists);

export default router;
