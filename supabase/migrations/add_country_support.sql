-- Multi-country support: add country column (ISO 3166-1 alpha-2) to core tables
-- Defaults to 'NL' so all existing data is tagged automatically

-- 1. stations
ALTER TABLE stations ADD COLUMN IF NOT EXISTS country text NOT NULL DEFAULT 'NL';
CREATE INDEX IF NOT EXISTS idx_stations_country ON stations(country);

-- 2. rail_lines
ALTER TABLE rail_lines ADD COLUMN IF NOT EXISTS country text NOT NULL DEFAULT 'NL';
CREATE INDEX IF NOT EXISTS idx_rail_lines_country ON rail_lines(country);

-- 3. user_station_visits — expand PK to include country
ALTER TABLE user_station_visits ADD COLUMN IF NOT EXISTS country text NOT NULL DEFAULT 'NL';
ALTER TABLE user_station_visits DROP CONSTRAINT IF EXISTS user_station_visits_pkey;
ALTER TABLE user_station_visits ADD PRIMARY KEY (user_id, station_code, country);

-- 4. journey_sessions — track which country context the journey was started in
ALTER TABLE journey_sessions ADD COLUMN IF NOT EXISTS country text NOT NULL DEFAULT 'NL';

-- 5. Drop old function signatures to avoid PostgREST overload ambiguity
--    CREATE OR REPLACE with new params creates overloads, not replacements
DROP FUNCTION IF EXISTS get_all_stations_with_tracks();
DROP FUNCTION IF EXISTS get_station_coords_batch(text[]);
DROP FUNCTION IF EXISTS insert_stations_batch(jsonb);
DROP FUNCTION IF EXISTS insert_rail_lines_batch(jsonb);
DROP FUNCTION IF EXISTS get_network_coverage();
DROP FUNCTION IF EXISTS find_open_routes(integer, text);
