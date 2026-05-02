-- Migration: Add `source` column to rail_point_overrides
-- Distinguishes manually edited overrides ('manual') from automatically
-- seeded ones ('seed'). Lets a future re-seed (e.g. after an AHN update)
-- target source='seed' rows without overwriting human edits.

ALTER TABLE public.rail_point_overrides
ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';

ALTER TABLE public.rail_point_overrides
DROP CONSTRAINT IF EXISTS rail_point_overrides_source_check;

ALTER TABLE public.rail_point_overrides
ADD CONSTRAINT rail_point_overrides_source_check
CHECK (source IN ('manual', 'seed'));

CREATE INDEX IF NOT EXISTS rail_point_overrides_source_idx
ON public.rail_point_overrides (source);
