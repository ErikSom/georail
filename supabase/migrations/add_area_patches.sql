-- Migration: Add area-patch columns to rail_patches.
-- A patch is a "route" patch when from_station IS NOT NULL, an "area" patch
-- when center_lat IS NOT NULL. Both kinds share the same rail_patch_data and
-- approval flow.

ALTER TABLE public.rail_patches
ADD COLUMN IF NOT EXISTS center_lat double precision,
ADD COLUMN IF NOT EXISTS center_lon double precision,
ADD COLUMN IF NOT EXISTS radius_m integer;
