ALTER TABLE journey_sessions ADD COLUMN IF NOT EXISTS station_tracks text[];
ALTER TABLE favorite_routes ADD COLUMN IF NOT EXISTS station_tracks text[];
