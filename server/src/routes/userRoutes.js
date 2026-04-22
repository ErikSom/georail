import express from 'express';
import rateLimit from 'express-rate-limit';
import {
    createUserRoute,
    listMyUserRoutes,
    getUserRoute,
    getSharedUserRoute,
    updateUserRoute,
    deleteUserRoute,
} from '../controllers/userRoutes.js';
import { authenticateOnly } from '../middleware/auth.js';

const readLimiter = rateLimit({
    windowMs: 1000,
    max: 10,
    message: 'Too many requests.',
    keyGenerator: (req) => req.headers['cf-connecting-ip'] || req.ip,
    validate: { trustProxy: true },
});

const writeLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 15,
    message: 'Too many write actions. Please wait a minute.',
    keyGenerator: (req) => req.headers['cf-connecting-ip'] || req.ip,
    validate: { trustProxy: true },
});

const router = express.Router();

router.get('/mine', readLimiter, authenticateOnly, listMyUserRoutes);
// Public share endpoint — declared BEFORE `/:id` so Express matches it first.
router.get('/shared/:id', readLimiter, getSharedUserRoute);
router.get('/:id', readLimiter, authenticateOnly, getUserRoute);
router.post('/', writeLimiter, authenticateOnly, createUserRoute);
router.patch('/:id', writeLimiter, authenticateOnly, updateUserRoute);
router.delete('/:id', writeLimiter, authenticateOnly, deleteUserRoute);

export default router;
