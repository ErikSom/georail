import express from 'express';
import rateLimit from 'express-rate-limit';
import { getRailChunk } from '../controllers/railChunks.js';

// Rail chunks are pure-read and cacheable. The client may legitimately
// fetch dozens of cells in parallel when first opening a viewport, so the
// per-IP cap is set high; CDN/browser cache catches the rest.
const limiter = rateLimit({
    windowMs: 1000,
    max: 200,
    message: 'Too many requests.',
    keyGenerator: (req) => req.headers['cf-connecting-ip'] || req.ip,
    validate: { trustProxy: true },
});

const router = express.Router();

router.get('/:lon(-?\\d+)/:lat(-?\\d+)', limiter, getRailChunk);

export default router;
