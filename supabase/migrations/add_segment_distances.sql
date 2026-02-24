-- Add segment_distances to journey_sessions for accurate route-based km rewards
-- Each entry is the route distance (km) from station i to station i+1
ALTER TABLE journey_sessions ADD COLUMN IF NOT EXISTS segment_distances double precision[] NOT NULL DEFAULT '{}';
