import { supabase } from '../supabase.js';

const MAX_AVERAGE_SPEED_KMH = 250;
const MAX_STATIONS = 30;

function haversineKm(lat1, lon1, lat2, lon2) {
	const R = 6371;
	const dLat = (lat2 - lat1) * Math.PI / 180;
	const dLon = (lon2 - lon1) * Math.PI / 180;
	const a = Math.sin(dLat / 2) ** 2 +
		Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
		Math.sin(dLon / 2) ** 2;
	return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export const startJourneySession = async (req, res) => {
	try {
		const { station_codes, country, segment_distances } = req.body;

		if (!Array.isArray(station_codes) || station_codes.length < 2 || station_codes.length > MAX_STATIONS) {
			return res.status(400).json({ error: 'Between 2 and 30 station codes required' });
		}

		if (!Array.isArray(segment_distances)
			|| segment_distances.length !== station_codes.length - 1
			|| !segment_distances.every(d => typeof d === 'number' && d > 0)) {
			return res.status(400).json({ error: 'segment_distances must have N-1 positive numbers' });
		}

		await supabase
			.from('journey_sessions')
			.update({ completed: true })
			.eq('user_id', req.userId)
			.eq('completed', false);

		const { data: coordRows, error: coordErr } = await supabase
			.rpc('get_station_coords_batch', { codes: station_codes });

		if (coordErr || !coordRows) {
			return res.status(500).json({ error: 'Could not fetch station coordinates' });
		}

		const coordMap = new Map();
		for (const row of coordRows) {
			coordMap.set(row.code, [row.lon, row.lat]);
		}

		const station_coords = station_codes.map(code => {
			const coord = coordMap.get(code);
			return coord || [0, 0];
		});

		const missingCodes = station_codes.filter(code => !coordMap.has(code));
		if (missingCodes.length > 0) {
			return res.status(400).json({ error: `Unknown stations: ${missingCodes.join(', ')}` });
		}

		// Validate segment distances against straight-line (anti-cheat)
		for (let i = 0; i < segment_distances.length; i++) {
			const [fromLon, fromLat] = station_coords[i];
			const [toLon, toLat] = station_coords[i + 1];
			const straightLine = haversineKm(fromLat, fromLon, toLat, toLon);
			if (segment_distances[i] < straightLine * 0.95 || segment_distances[i] > straightLine * 3) {
				return res.status(400).json({ error: 'Invalid segment distances' });
			}
		}

		// Check which route stations the user has already visited
		const sessionCountry = country || 'NL';
		const { data: existingVisits } = await supabase
			.from('user_station_visits')
			.select('station_code')
			.eq('user_id', req.userId)
			.eq('country', sessionCountry)
			.in('station_code', station_codes);

		const alreadyVisited = (existingVisits || []).map(v => v.station_code);

		const { data, error } = await supabase
			.from('journey_sessions')
			.insert({
				user_id: req.userId,
				station_codes,
				station_coords,
				segment_distances,
				country: sessionCountry,
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
		res.json({ session_id: data.id, already_visited: alreadyVisited });
	} catch (err) {
		console.error('Journey start error:', err);
		res.status(500).json({ error: 'Server error' });
	}
};

export const reportStationArrival = async (req, res) => {
	try {
		const { session_id, station_index } = req.body;

		if (!session_id || typeof station_index !== 'number') {
			return res.status(400).json({ error: 'session_id and station_index required' });
		}

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

		const expectedIndex = session.last_station_index + 1;
		if (station_index !== expectedIndex || station_index >= session.station_codes.length) {
			return res.status(400).json({ error: 'Invalid station_index' });
		}

		const distanceKm = session.segment_distances[station_index - 1];

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

		await supabase
			.from('journey_sessions')
			.update({
				last_station_index: station_index,
				last_ping_at: now.toISOString(),
				total_km_earned: newTotalKmEarned,
				completed: isComplete,
			})
			.eq('id', session_id);

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

		// Credit start station when arriving at station 1
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

		const toCode = session.station_codes[station_index];
		await supabase
			.from('user_station_visits')
			.upsert({
				user_id: req.userId,
				station_code: toCode,
				country: sessionCountry,
				first_visited_at: now.toISOString(),
			}, { onConflict: 'user_id,station_code,country', ignoreDuplicates: true });

		const { count: totalStationsVisited } = await supabase
			.from('user_station_visits')
			.select('*', { count: 'exact', head: true })
			.eq('user_id', req.userId);

		res.set('Cache-Control', 'no-store');
		res.json({
			valid: true,
			km_added: Math.round(distanceKm * 100) / 100,
			total_km: Math.round(newTotalKm * 100) / 100,
			is_complete: isComplete,
			total_stations_visited: totalStationsVisited || 0,
			journey_km: Math.round(newTotalKmEarned * 100) / 100,
		});
	} catch (err) {
		console.error('Station arrival error:', err);
		res.status(500).json({ error: 'Server error' });
	}
};

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
