-- Round trip flag on journey sessions
ALTER TABLE journey_sessions ADD COLUMN IF NOT EXISTS is_round_trip boolean NOT NULL DEFAULT false;

-- Index for efficient history queries on completed journey sessions
CREATE INDEX IF NOT EXISTS idx_journey_sessions_user_completed
  ON journey_sessions(user_id, started_at DESC) WHERE completed = true;

-- Favorite routes table
CREATE TABLE IF NOT EXISTS favorite_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  route_hash text NOT NULL,
  station_codes text[] NOT NULL,
  station_names text[],
  total_km double precision,
  is_round_trip boolean NOT NULL DEFAULT false,
  country text NOT NULL DEFAULT 'NL',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One favorite per route per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_favorite_routes_unique
  ON favorite_routes(user_id, route_hash, country);

CREATE INDEX IF NOT EXISTS idx_favorite_routes_user
  ON favorite_routes(user_id, created_at DESC);

-- RLS
ALTER TABLE favorite_routes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own favorites" ON favorite_routes
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own favorites" ON favorite_routes
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own favorites" ON favorite_routes
  FOR DELETE USING (auth.uid() = user_id);
