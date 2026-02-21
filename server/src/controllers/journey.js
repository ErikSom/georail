import { supabase } from '../supabase.js';

const MAX_AVERAGE_SPEED_KMH = 250;
const MAX_STATIONS = 30;

/**
 * Haversine distance in km between two lat/lon points
 */
function haversineKm(lat1, lon1, lat2, lon2) {
	const R = 6371;
	const dLat = (lat2 - lat1) * Math.PI / 180;
	const dLon = (lon2 - lon1) * Math.PI / 180;
	const a = Math.sin(dLat / 2) ** 2 +
		Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
		Math.sin(dLon / 2) ** 2;
	return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * POST /user/journey/start
 * Body: { station_codes: string[] }
 * Creates a journey session and returns its ID.
 */
export const startJourneySession = async (req, res) => {
	try {
		const { station_codes, country } = req.body;

		if (!Array.isArray(station_codes) || station_codes.length < 2 || station_codes.length > MAX_STATIONS) {
			return res.status(400).json({ error: 'Between 2 and 30 station codes required' });
		}

		// Cancel any existing active sessions for this user
		await supabase
			.from('journey_sessions')
			.update({ completed: true })
			.eq('user_id', req.userId)
			.eq('completed', false);

		// Fetch coordinates for all stations via PostGIS function
		const { data: coordRows, error: coordErr } = await supabase
			.rpc('get_station_coords_batch', { codes: station_codes });

		if (coordErr || !coordRows) {
			return res.status(500).json({ error: 'Could not fetch station coordinates' });
		}

		const coordMap = new Map();
		for (const row of coordRows) {
			coordMap.set(row.code, [row.lon, row.lat]);
		}

		// Build ordered coordinate array matching station_codes order
		const station_coords = station_codes.map(code => {
			const coord = coordMap.get(code);
			return coord || [0, 0]; // fallback shouldn't happen
		});

		// Verify all stations were found
		const missingCodes = station_codes.filter(code => !coordMap.has(code));
		if (missingCodes.length > 0) {
			return res.status(400).json({ error: `Unknown stations: ${missingCodes.join(', ')}` });
		}

		// Create session
		const { data, error } = await supabase
			.from('journey_sessions')
			.insert({
				user_id: req.userId,
				station_codes,
				station_coords,
				country: country || 'NL',
				last_station_index: 0,
				last_ping_at: new Date().toISOString(),
				total_km_earned: 0,
				completed: false,
			})
			.select('id')
			.single();

		if (error) {
			return res.status(500).json({ error: error.message });
		}

		res.set('Cache-Control', 'no-store');
		res.json({ session_id: data.id });
	} catch (err) {
		console.error('Journey start error:', err);
		res.status(500).json({ error: 'Server error' });
	}
};

/**
 * POST /user/journey/station
 * Body: { session_id: string, station_index: number }
 * Validates arrival and accumulates km.
 */
export const reportStationArrival = async (req, res) => {
	try {
		const { session_id, station_index } = req.body;

		if (!session_id || typeof station_index !== 'number') {
			return res.status(400).json({ error: 'session_id and station_index required' });
		}

		// Fetch session
		const { data: session, error: sessionError } = await supabase
			.from('journey_sessions')
			.select('*')
			.eq('id', session_id)
			.eq('user_id', req.userId)
			.eq('completed', false)
			.single();

		if (sessionError || !session) {
			return res.status(404).json({ error: 'Session not found or completed' });
		}

		// Validate station_index is the next expected
		const expectedIndex = session.last_station_index + 1;
		if (station_index !== expectedIndex || station_index >= session.station_codes.length) {
			return res.status(400).json({ error: 'Invalid station_index' });
		}

		// Compute distance between previous and current station using stored coords
		const [fromLon, fromLat] = session.station_coords[session.last_station_index];
		const [toLon, toLat] = session.station_coords[station_index];
		const distanceKm = haversineKm(fromLat, fromLon, toLat, toLon);

		// Anti-cheat: check travel time (250 km/h max with 10% tolerance)
		const now = new Date();
		const lastPing = new Date(session.last_ping_at);
		const elapsedHours = (now.getTime() - lastPing.getTime()) / (1000 * 60 * 60);
		const minTimeHours = distanceKm / MAX_AVERAGE_SPEED_KMH;

		if (elapsedHours < minTimeHours * 0.9) {
			return res.status(400).json({ error: 'Travel time too short', valid: false });
		}

		const newTotalKmEarned = session.total_km_earned + distanceKm;
		const isComplete = station_index === session.station_codes.length - 1;

		// Update session
		await supabase
			.from('journey_sessions')
			.update({
				last_station_index: station_index,
				last_ping_at: now.toISOString(),
				total_km_earned: newTotalKmEarned,
				completed: isComplete,
			})
			.eq('id', session_id);

		// Atomically increment user total_km
		const { data: profile } = await supabase
			.from('profiles')
			.select('total_km')
			.eq('id', req.userId)
			.single();

		const newTotalKm = (profile?.total_km || 0) + distanceKm;
		await supabase
			.from('profiles')
			.update({ total_km: newTotalKm })
			.eq('id', req.userId);

		// When arriving at station 1, also credit the start station
		// (start station is only unlocked after proving you traveled to the next one)
		const sessionCountry = session.country || 'NL';
		if (station_index === 1) {
			await supabase
				.from('user_station_visits')
				.upsert({
					user_id: req.userId,
					station_code: session.station_codes[0],
					country: sessionCountry,
					first_visited_at: now.toISOString(),
				}, { onConflict: 'user_id,station_code,country', ignoreDuplicates: true });
		}

		// Record station visit (upsert, ignore if exists)
		const toCode = session.station_codes[station_index];
		const { data: visitResult } = await supabase
			.from('user_station_visits')
			.upsert({
				user_id: req.userId,
				station_code: toCode,
				country: sessionCountry,
				first_visited_at: now.toISOString(),
			}, { onConflict: 'user_id,station_code,country', ignoreDuplicates: true })
			.select();

		const newStation = visitResult && visitResult.length > 0;

		// Count total stations visited
		const { count: totalStationsVisited } = await supabase
			.from('user_station_visits')
			.select('*', { count: 'exact', head: true })
			.eq('user_id', req.userId);

		res.set('Cache-Control', 'no-store');
		res.json({
			valid: true,
			km_added: Math.round(distanceKm * 100) / 100,
			total_km: Math.round(newTotalKm * 100) / 100,
			new_station: !!newStation,
			station_code: toCode,
			is_complete: isComplete,
			total_stations_visited: totalStationsVisited || 0,
			journey_km: Math.round(newTotalKmEarned * 100) / 100,
		});
	} catch (err) {
		console.error('Station arrival error:', err);
		res.status(500).json({ error: 'Server error' });
	}
};

/**
 * GET /user/stats
 * Returns user stats: total_km, visited stations.
 */
export const getUserStats = async (req, res) => {
	try {
		const { country } = req.query;

		const { data: profile } = await supabase
			.from('profiles')
			.select('total_km')
			.eq('id', req.userId)
			.single();

		let visitsQuery = supabase
			.from('user_station_visits')
			.select('station_code, country')
			.eq('user_id', req.userId);

		if (country) {
			visitsQuery = visitsQuery.eq('country', country.toUpperCase());
		}

		const { data: visits } = await visitsQuery;

		res.set('Cache-Control', 'private, no-cache, no-store, must-revalidate');
		res.json({
			total_km: profile?.total_km || 0,
			stations_visited: (visits || []).map(v => v.station_code),
			total_stations_visited: (visits || []).length,
		});
	} catch (err) {
		console.error('Stats error:', err);
		res.status(500).json({ error: 'Server error' });
	}
};
