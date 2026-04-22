-- Link a journey_session to a user_routes row so we can flag user-route plays
-- and skip station-dependent anti-cheat / visit tracking for them.

ALTER TABLE journey_sessions
  ADD COLUMN IF NOT EXISTS is_user_route boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS user_route_id uuid REFERENCES user_routes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_journey_sessions_user_route
  ON journey_sessions(user_route_id) WHERE user_route_id IS NOT NULL;
