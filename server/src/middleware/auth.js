import { supabase } from "../supabase.js";

const DEFAULT_TTL_MS = 600 * 1000; // 10 minutes
const DEFAULT_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

class AuthCache {
	constructor(ttl = DEFAULT_TTL_MS) {
		this.cache = new Map();
		this.ttl = ttl;
		const cleanupInterval = DEFAULT_CLEANUP_INTERVAL_MS;
		setInterval(() => this.cleanup(), cleanupInterval);
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

export const checkAuthStatus = async (token) => {
	try {
		const cachedStatus = authCache.get(token);
		if (cachedStatus) return cachedStatus;

		const { data: { user }, error } = await supabase.auth.getUser(token);

		if (error || !user) {
			return { isAuthorized: false };
		}

		const { data: profile, error: profileError } = await supabase
			.from('profiles')
			.select('beta_access')
			.eq('id', user.id)
			.single();

		const authStatus = {
			isAuthorized: !profileError && profile?.beta_access === true,
			userId: user.id
		};

		authCache.set(token, authStatus);
		return authStatus;
	} catch (error) {
		console.error('Auth check error:', error);
		return { isAuthorized: false };
	}
};

export const authenticateAndAuthorize = async (req, res, next) => {
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
