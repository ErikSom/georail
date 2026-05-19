CREATE OR REPLACE FUNCTION find_open_routes(
  max_results integer DEFAULT 10,
  line_filter text DEFAULT NULL,
  p_country text DEFAULT NULL
)
RETURNS json
LANGUAGE sql
VOLATILE
SET search_path = public, extensions
AS $$
  WITH segment_coverage AS (
    SELECT
      rl.id as segment_id,
      rl.geom,
      rl.properties,
      rl.length_m,
      ST_NPoints(rl.geom) as total_points,
      COALESCE(o.covered_points, 0) as covered_points
    FROM rail_lines rl
    LEFT JOIN (
      SELECT segment_id, COUNT(*) as covered_points
      FROM rail_point_overrides
      GROUP BY segment_id
    ) o ON o.segment_id = rl.id
    WHERE (p_country IS NULL OR rl.country = p_country)
  ),
  -- Segments with zero altitude work done (capped to limit spatial lookups)
  uncovered AS (
    SELECT *
    FROM segment_coverage
    WHERE covered_points = 0
      AND (line_filter IS NULL OR properties->>'ref' = line_filter)
    ORDER BY random()
    LIMIT 500
  ),
  -- Map each uncovered segment to nearest station at start and end
  with_stations AS (
    SELECT
      u.segment_id,
      u.properties->>'ref' as line_ref,
      u.properties->>'description' as line_desc,
      u.length_m,
      u.total_points,
      src_s.name as from_name,
      src_s.code as from_code,
      tgt_s.name as to_name,
      tgt_s.code as to_code
    FROM uncovered u
    CROSS JOIN LATERAL (
      SELECT name, code
      FROM stations
      ORDER BY geom <-> ST_StartPoint(u.geom)
      LIMIT 1
    ) src_s
    CROSS JOIN LATERAL (
      SELECT name, code
      FROM stations
      WHERE name != src_s.name
      ORDER BY geom <-> ST_EndPoint(u.geom)
      LIMIT 1
    ) tgt_s
  )
  -- Group by station pair + line, deduplicate direction
  SELECT COALESCE(json_agg(route_data), '[]'::json)
  FROM (
    SELECT
      LEAST(from_name, to_name) as station_a,
      GREATEST(from_name, to_name) as station_b,
      CASE WHEN from_name <= to_name THEN from_code ELSE to_code END as code_a,
      CASE WHEN from_name <= to_name THEN to_code ELSE from_code END as code_b,
      line_ref,
      MAX(line_desc) as line_description,
      COUNT(*) as segment_count,
      SUM(total_points)::int as points_to_do,
      ROUND(SUM(length_m)::numeric / 1000, 1) as length_km
    FROM with_stations
    GROUP BY
      LEAST(from_name, to_name),
      GREATEST(from_name, to_name),
      CASE WHEN from_name <= to_name THEN from_code ELSE to_code END,
      CASE WHEN from_name <= to_name THEN to_code ELSE from_code END,
      line_ref
    ORDER BY segment_count DESC
    LIMIT max_results
  ) route_data;
$$;
