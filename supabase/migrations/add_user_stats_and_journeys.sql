-- 1. Add total_km to profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS total_km double precision NOT NULL DEFAULT 0;

-- 2. Create journey_sessions table for anti-cheat tracking
CREATE TABLE IF NOT EXISTS journey_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  station_codes text[] NOT NULL,
  station_coords float[][] NOT NULL DEFAULT '{}',
  last_station_index int NOT NULL DEFAULT 0,
  last_ping_at timestamptz NOT NULL DEFAULT now(),
  total_km_earned double precision NOT NULL DEFAULT 0,
  completed boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_journey_sessions_user_active
  ON journey_sessions(user_id) WHERE completed = false;

-- 3. Create user_station_visits table
CREATE TABLE IF NOT EXISTS user_station_visits (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  station_code text NOT NULL,
  first_visited_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, station_code)
);

-- 4. RLS policies
ALTER TABLE journey_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_station_visits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own sessions" ON journey_sessions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can view own visits" ON user_station_visits
  FOR SELECT USING (auth.uid() = user_id);
