import dotenv from 'dotenv';
import path from 'path';
import express from 'express';
import { initializeSupabase } from './supabase.js';

import navigationRoutes from './routes/navigation.js';
import stationsRoutes from './routes/stations.js';
import patchesRoutes from './routes/patches.js';
import userRoutes from './routes/user.js';

const envFile = '.env';
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

const app = express();

// ✅ 1. Trust Proxy (Must be set before routes/limiters)
// This allows the rate limiters to see 'cf-connecting-ip' correctly
app.set('trust proxy', 1);

initializeSupabase();

app.use(express.json());

// ✅ 2. Refined CORS Middleware
app.use((req, res, next) => {
    const allowedOrigins = ['http://localhost:4321', 'https://georail-app.pages.dev', 'https://georail.app'];
    const origin = req.headers.origin;

    if (allowedOrigins.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
        res.header('Access-Control-Allow-Credentials', 'true');

        // This tells the browser to cache the preflight result for 10 minutes
        res.header('Access-Control-Max-Age', '600');

        res.header(
            'Access-Control-Allow-Headers',
            'Origin, X-Requested-With, Content-Type, Accept, Authorization'
        );
        res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE, PATCH');
    }

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    next();
});

// ✅ 3. Routes
app.use('/navi', navigationRoutes);
app.use('/stations', stationsRoutes);
app.use('/patches', patchesRoutes);
app.use('/user', userRoutes);

// ✅ 4. Health Check & Root
app.get('/health', (req, res) => res.status(200).send('OK'));
app.get('/', (req, res) => {
    res.json({ message: 'GeoRail API Server is running!' });
});

const PORT = process.env.APP_PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
