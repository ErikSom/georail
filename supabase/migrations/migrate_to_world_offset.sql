-- Migration: Convert height/lateral_offset to world_offset array
-- Run this in your Supabase SQL Editor

-- 1. Update rail_point_overrides table
-- Add new world_offset column
ALTER TABLE public.rail_point_overrides
ADD COLUMN IF NOT EXISTS world_offset double precision[3];

-- Migrate existing data: [x=0, y=height, z=lateral_offset]
-- Note: lateral_offset was previously the "sideways" offset, now it goes in Z
UPDATE public.rail_point_overrides
SET world_offset = ARRAY[
    0.0,
    COALESCE(height, 0.0),
    COALESCE(lateral_offset, 0.0)
]::double precision[]
WHERE world_offset IS NULL;

-- Drop old columns (only after verifying data migrated correctly)
-- ALTER TABLE public.rail_point_overrides DROP COLUMN IF EXISTS height;
-- ALTER TABLE public.rail_point_overrides DROP COLUMN IF EXISTS lateral_offset;

-- 2. Update rail_patch_data table
-- Add new world_offset column
ALTER TABLE public.rail_patch_data
ADD COLUMN IF NOT EXISTS world_offset double precision[3];

-- Migrate existing data
UPDATE public.rail_patch_data
SET world_offset = ARRAY[
    0.0,
    COALESCE(height, 0.0),
    COALESCE(lateral_offset, 0.0)
]::double precision[]
WHERE world_offset IS NULL;

-- Drop old columns (only after verifying data migrated correctly)
-- ALTER TABLE public.rail_patch_data DROP COLUMN IF EXISTS height;
-- ALTER TABLE public.rail_patch_data DROP COLUMN IF EXISTS lateral_offset;

-- 3. Set NOT NULL constraint after migration (optional)
-- ALTER TABLE public.rail_point_overrides ALTER COLUMN world_offset SET NOT NULL;
-- ALTER TABLE public.rail_patch_data ALTER COLUMN world_offset SET NOT NULL;

-- 4. Add default value for new rows
ALTER TABLE public.rail_point_overrides
ALTER COLUMN world_offset SET DEFAULT ARRAY[0.0, 0.0, 0.0]::double precision[];

ALTER TABLE public.rail_patch_data
ALTER COLUMN world_offset SET DEFAULT ARRAY[0.0, 0.0, 0.0]::double precision[];
