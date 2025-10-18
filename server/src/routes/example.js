// server.js
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Simple in-memory cache for auth status
class AuthCache {
  constructor(ttlSeconds = 3600) {
    this.cache = new Map();
    this.ttl = ttlSeconds * 1000;
    setInterval(() => this.cleanup(), 3600000);
  }

  set(token, value) {
    this.cache.set(token, {
      value,
      timestamp: Date.now()
    });
  }

  get(token) {
    const entry = this.cache.get(token);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(token);
      return null;
    }
    return entry.value;
  }

  delete(token) {
    this.cache.delete(token);
  }

  cleanup() {
    const now = Date.now();
    for (const [token, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.ttl) {
        this.cache.delete(token);
      }
    }
  }
}

const authCache = new AuthCache();

// Check auth status from cache or verify
const checkAuthStatus = async (token) => {
  try {
    const cachedStatus = authCache.get(token);
    if (cachedStatus) return cachedStatus;

    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return { isAuthorized: false };
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('betaAccess')
      .eq('id', user.id)
      .single();

    const authStatus = {
      isAuthorized: !profileError && profile?.betaAccess === true,
      userId: user.id
    };

    authCache.set(token, authStatus);
    return authStatus;
  } catch (error) {
    console.error('Auth check error:', error);
    return { isAuthorized: false };
  }
};

// Auth middleware
const authenticateAndAuthorize = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const authStatus = await checkAuthStatus(token);

    if (!authStatus.isAuthorized) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    req.userId = authStatus.userId;
    next();
  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
};

// Proxy endpoint for Map Tiles API
app.get('/api/tiles/*', authenticateAndAuthorize, async (req, res) => {
  try {
    const path = req.params[0];
    // Get session from header instead of query param for better caching
    const session = req.headers['x-session-id'];

    const googleUrl = `https://tile.googleapis.com/v1/3dtiles/${path}?key=${process.env.GOOGLE_API_KEY}&session=${session}`;

    const response = await axios({
      method: 'get',
      url: googleUrl,
      responseType: 'stream',
      headers: {
        'Accept': req.headers.accept,
        'User-Agent': req.headers['user-agent'],
        // Forward If-None-Match for ETag support
        'If-None-Match': req.headers['if-none-match'],
        // Forward If-Modified-Since for cache validation
        'If-Modified-Since': req.headers['if-modified-since']
      },
      // Handle 304 Not Modified responses
      validateStatus: status => (status >= 200 && status < 300) || status === 304
    });

    // Forward all response headers from Google
    Object.entries(response.headers).forEach(([key, value]) => {
      // Forward cache-related headers exactly as received
      if (key.toLowerCase() === 'cache-control' ||
        key.toLowerCase() === 'etag' ||
        key.toLowerCase() === 'last-modified') {
        res.setHeader(key, value);
      }
    });

    // Add Cloudflare-specific cache header
    // This doesn't override Google's cache settings, just helps Cloudflare
    res.setHeader('CDN-Cache-Control', 'public');

    // Forward HTTP status
    res.status(response.status);

    // Stream the response
    response.data.pipe(res);
  } catch (error) {
    console.error('Proxy error:', error);
    res.status(500).json({ error: 'Failed to fetch tile data' });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
