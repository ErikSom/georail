ALTER TABLE public.rail_patches
ADD COLUMN IF NOT EXISTS via_stops jsonb;

COMMENT ON COLUMN public.rail_patches.via_stops IS 'Array of intermediate stops: [{station, stationCode, track}]';
