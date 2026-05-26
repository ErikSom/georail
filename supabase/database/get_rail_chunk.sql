-- Returns the rail network geometry for a single chunk, enough for the
-- client to snap NS positions to the track and route between snaps locally.
--
-- A segment is included in a chunk iff its bounding box intersects the
-- chunk's bbox — so segments crossing chunk boundaries are duplicated into
-- both neighbouring chunks. The client deduplicates by segment id and
-- stitches the rail graph across chunks via the opaque (source, target)
-- node ids.
--
-- The world_offset values are returned aligned to the segment's vertices
-- so the client can apply per-vertex world-coordinate corrections without
-- a second lookup.

CREATE OR REPLACE FUNCTION get_rail_chunk(
  lon_min double precision,
  lat_min double precision,
  lon_max double precision,
  lat_max double precision,
  p_country text DEFAULT 'NL'
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH bounds AS (
    SELECT ST_MakeEnvelope(lon_min, lat_min, lon_max, lat_max, 4326) AS env
  ),
  segments AS (
    SELECT
      rl.id,
      rl.source,
      rl.target,
      rl.length_m,
      ST_AsGeoJSON(rl.geom)::jsonb -> 'coordinates' AS coords
    FROM rail_lines rl, bounds b
    WHERE rl.country = p_country
      AND rl.geom && b.env
  ),
  with_offsets AS (
    SELECT
      s.id,
      s.source,
      s.target,
      s.length_m,
      s.coords,
      COALESCE(
        (SELECT jsonb_agg(rn.world_offset ORDER BY rn.point_index)
         FROM rail_nodes rn
         WHERE rn.segment_id = s.id),
        '[]'::jsonb
      ) AS world_offsets
    FROM segments s
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id,
    'source', source,
    'target', target,
    'lengthM', length_m,
    'geom', coords,
    'worldOffsets', world_offsets
  ) ORDER BY id), '[]'::jsonb)
  FROM with_offsets;
$$;
