-- Returns every rail point inside a circular area, in the same JSON shape as
-- find_journey_route's editor mode (parallel `route` and `editor` arrays plus
-- a metadata array). Used by the editor's "area" patch type so a moderator
-- can edit all rail in a station/junction area at once.

CREATE OR REPLACE FUNCTION get_rail_in_area(
  p_lat double precision,
  p_lon double precision,
  p_radius_m double precision,
  p_country text DEFAULT 'NL'
)
RETURNS json
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  WITH center AS (
    SELECT ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography AS pt
  ),
  in_area AS (
    SELECT id, geom, properties
    FROM rail_lines
    WHERE country = p_country
      AND ST_DWithin(geom::geography, (SELECT pt FROM center), p_radius_m)
  ),
  points AS (
    SELECT
      a.id AS segment_id,
      (dp.path[1] - 1)::integer AS point_index,
      ST_X(dp.geom) AS lon,
      ST_Y(dp.geom) AS lat,
      COALESCE(ovr.world_offset, ARRAY[0.0, COALESCE(ST_Z(dp.geom), 0.0), 0.0]::double precision[]) AS world_offset,
      COALESCE((a.properties->>'maxspeed')::int, 0) AS max_speed,
      ovr.source AS source
    FROM in_area a
    CROSS JOIN LATERAL ST_DumpPoints(a.geom) AS dp
    LEFT JOIN rail_point_overrides ovr
      ON ovr.segment_id = a.id AND ovr.point_index = (dp.path[1] - 1)
  )
  SELECT json_build_object(
    'route', COALESCE(json_agg(
      json_build_array(p.lon, p.lat, p.world_offset[1], p.world_offset[2], p.world_offset[3])
      ORDER BY p.segment_id, p.point_index
    ), '[]'::json),
    'editor', COALESCE(json_agg(
      json_build_object('segment_id', p.segment_id, 'index', p.point_index)
      ORDER BY p.segment_id, p.point_index
    ), '[]'::json),
    'metadata', COALESCE(json_agg(
      json_build_object('max_speed', p.max_speed, 'source', p.source)
      ORDER BY p.segment_id, p.point_index
    ), '[]'::json),
    'stop_indices', '[]'::json
  )
  FROM points p;
$$;
