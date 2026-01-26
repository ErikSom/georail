import express from 'express';
import rateLimit from 'express-rate-limit';
import {
    getMyPatches,
    getAllPatches,
    submitPatch,
    approvePatch,
    updatePatchStatus
} from '../controllers/patches.js';
import { authenticateAndAuthorize } from '../middleware/auth.js';

// Standard limiter for fetching lists (GET requests)
const patchReadLimiter = rateLimit({
    windowMs: 1000,
    max: 10,
    message: 'Too many requests.',
    // identify unique users behind Cloudflare
    keyGenerator: (req) => {
        return req.headers['cf-connecting-ip'] || req.ip;
    },
    validate: { trustProxy: true }
});

// Stricter limiter for database mutations (POST, PUT, DELETE)
const patchActionLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 15,            // Max 15 actions per minute
    message: 'Too many patch actions. Please wait a minute.',
    // identify unique users behind Cloudflare
    keyGenerator: (req) => {
        return req.headers['cf-connecting-ip'] || req.ip;
    },
    validate: { trustProxy: true }
});

const router = express.Router();

// === USER ROUTES ===

// Fetch personal patches
router.get('/my', patchReadLimiter, authenticateAndAuthorize, getMyPatches);

// Submit a new patch or update an existing one
router.post('/submit', patchActionLimiter, authenticateAndAuthorize, submitPatch);

// Update status (cancel or reopen personal patches)
router.patch('/status', patchActionLimiter, authenticateAndAuthorize, updatePatchStatus);


// === MODERATOR ROUTES ===

// Fetch all patches (Moderator view)
router.get('/all', patchReadLimiter, authenticateAndAuthorize, getAllPatches);

// Approve a patch
router.post('/approve', patchActionLimiter, authenticateAndAuthorize, approvePatch);

export default router;