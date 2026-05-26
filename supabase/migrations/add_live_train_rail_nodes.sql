-- Live train snapping support.
-- `rail_nodes` materializes rail line vertices plus GeoRail world offsets so
-- live-train rendering can snap to the same corrected rail surface as journeys.

ALTER TABLE public.rail_lines
ADD COLUMN IF NOT EXISTS country text NOT NULL DEFAULT 'NL';

CREATE TABLE IF NOT EXISTS public.rail_nodes (
  segment_id bigint NOT NULL REFERENCES public.rail_lines(id) ON DELETE CASCADE,
  point_index integer NOT NULL,
  geom geometry(Point, 4326) NOT NULL,
  world_offset double precision[3] NOT NULL DEFAULT ARRAY[0.0, 0.0, 0.0]::double precision[],
  country text NOT NULL DEFAULT 'NL',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (segment_id, point_index)
);

CREATE INDEX IF NOT EXISTS rail_nodes_geom_idx
ON public.rail_nodes
USING gist (geom);

CREATE INDEX IF NOT EXISTS rail_nodes_country_idx
ON public.rail_nodes (country);

CREATE OR REPLACE FUNCTION public.refresh_rail_nodes_for_segment(p_segment_id bigint)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  DELETE FROM rail_nodes WHERE segment_id = p_segment_id;

  INSERT INTO rail_nodes (segment_id, point_index, geom, world_offset, country)
  SELECT
    rl.id,
    (dp.path[1] - 1)::integer,
    ST_SetSRID(ST_MakePoint(ST_X(dp.geom), ST_Y(dp.geom)), 4326),
    COALESCE(
      ovr.world_offset,
      ARRAY[0.0, COALESCE(ST_Z(dp.geom), 0.0), 0.0]::double precision[]
    ),
    rl.country
  FROM rail_lines rl
  CROSS JOIN LATERAL ST_DumpPoints(rl.geom) AS dp
  LEFT JOIN rail_point_overrides ovr
    ON ovr.segment_id = rl.id
   AND ovr.point_index = (dp.path[1] - 1)
  WHERE rl.id = p_segment_id;
$$;

INSERT INTO public.rail_nodes (segment_id, point_index, geom, world_offset, country)
SELECT
  rl.id,
  (dp.path[1] - 1)::integer,
  ST_SetSRID(ST_MakePoint(ST_X(dp.geom), ST_Y(dp.geom)), 4326),
  COALESCE(
    ovr.world_offset,
    ARRAY[0.0, COALESCE(ST_Z(dp.geom), 0.0), 0.0]::double precision[]
  ),
  rl.country
FROM public.rail_lines rl
CROSS JOIN LATERAL ST_DumpPoints(rl.geom) AS dp
LEFT JOIN public.rail_point_overrides ovr
  ON ovr.segment_id = rl.id
 AND ovr.point_index = (dp.path[1] - 1)
ON CONFLICT (segment_id, point_index) DO UPDATE
SET
  geom = EXCLUDED.geom,
  world_offset = EXCLUDED.world_offset,
  country = EXCLUDED.country,
  updated_at = now();

CREATE OR REPLACE FUNCTION public.refresh_rail_nodes_for_rail_line_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  PERFORM public.refresh_rail_nodes_for_segment(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS refresh_rail_nodes_after_rail_line_change ON public.rail_lines;
CREATE TRIGGER refresh_rail_nodes_after_rail_line_change
AFTER INSERT OR UPDATE OF geom, country ON public.rail_lines
FOR EACH ROW
EXECUTE FUNCTION public.refresh_rail_nodes_for_rail_line_trigger();

CREATE OR REPLACE FUNCTION public.refresh_rail_nodes_for_override_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  seg_id bigint;
BEGIN
  seg_id := COALESCE(NEW.segment_id, OLD.segment_id);
  PERFORM public.refresh_rail_nodes_for_segment(seg_id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS refresh_rail_nodes_after_override_change ON public.rail_point_overrides;
CREATE TRIGGER refresh_rail_nodes_after_override_change
AFTER INSERT OR UPDATE OF world_offset OR DELETE ON public.rail_point_overrides
FOR EACH ROW
EXECUTE FUNCTION public.refresh_rail_nodes_for_override_trigger();
