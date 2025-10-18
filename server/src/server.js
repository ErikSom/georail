import dotenv from 'dotenv';
import path from 'path';
import express from 'express';
import { initializeSupabase } from './supabase.js';
import navigationRoutes from './routes/navigation.js';

const envFile = '.env';
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

const app = express();

initializeSupabase();

app.use(express.json());

app.use((req, res, next) => {
    const allowedOrigins = ['https://playcanvas.com', 'https://launch.playcanvas.com'];
    const origin = req.headers.origin;

    if (allowedOrigins.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
        res.header('Access-Control-Allow-Credentials', 'true');
        res.header(
            'Access-Control-Allow-Headers',
            'Origin, X-Requested-With, Content-Type, Accept, Authorization'
        );
        res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    }

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    next();
});

app.use('/navi', navigationRoutes);

app.get('/', (req, res) => {
    res.json({ message: 'Server is running!' });
});

app.listen(process.env.APP_PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${process.env.APP_PORT}`);
});

// we trust the proxy to make rate limiting work with fly.io
app.set('trust proxy', 1);
