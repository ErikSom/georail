-- Custom user routes built from OSM data via the /user-routes editor.
-- Fully isolated from existing tables (rail_patches, stations, journey_sessions).

CREATE TABLE IF NOT EXISTS user_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  osm_ref text,
  osm_relation_id bigint,
  geometry jsonb NOT NULL,
  stops jsonb NOT NULL,
  point_count int NOT NULL,
  country text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_routes_user
  ON user_routes(user_id, updated_at DESC);

ALTER TABLE user_routes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own user_routes" ON user_routes
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own user_routes" ON user_routes
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own user_routes" ON user_routes
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own user_routes" ON user_routes
  FOR DELETE USING (auth.uid() = user_id);
