-- Add route information columns to rail_patches table
ALTER TABLE public.rail_patches
ADD COLUMN IF NOT EXISTS from_station text,
ADD COLUMN IF NOT EXISTS from_track text,
ADD COLUMN IF NOT EXISTS to_station text,
ADD COLUMN IF NOT EXISTS to_track text,
ADD COLUMN IF NOT EXISTS description text;

-- Add comment to describe the new columns
COMMENT ON COLUMN public.rail_patches.from_station IS 'Starting station name for the patch route';
COMMENT ON COLUMN public.rail_patches.from_track IS 'Starting track number/identifier';
COMMENT ON COLUMN public.rail_patches.to_station IS 'Destination station name for the patch route';
COMMENT ON COLUMN public.rail_patches.to_track IS 'Destination track number/identifier';
COMMENT ON COLUMN public.rail_patches.description IS 'User-provided description of the patch changes';
