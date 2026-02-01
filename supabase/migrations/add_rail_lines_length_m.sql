-- Add pre-computed length column to rail_lines for faster Dijkstra queries
-- This avoids computing ST_Length(geom::geography) on every pathfinding call

-- Add the column
ALTER TABLE rail_lines ADD COLUMN IF NOT EXISTS length_m FLOAT;

-- Populate with current geometry lengths
UPDATE rail_lines SET length_m = ST_Length(geom::geography);

-- Add NOT NULL constraint after populating
ALTER TABLE rail_lines ALTER COLUMN length_m SET NOT NULL;

-- Note: If you modify rail_lines geometry, run this to update lengths:
-- UPDATE rail_lines SET length_m = ST_Length(geom::geography);
