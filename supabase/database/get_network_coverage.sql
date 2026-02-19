CREATE OR REPLACE FUNCTION get_network_coverage(
  p_country text DEFAULT NULL
)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH segment_stats AS (
    SELECT
      rl.id,
      rl.properties->>'ref' as line_ref,
      rl.properties->>'description' as line_desc,
      ST_NPoints(rl.geom) as total_points,
      COALESCE(o.covered_points, 0) as covered_points,
      rl.length_m
    FROM rail_lines rl
    LEFT JOIN (
      SELECT segment_id, COUNT(*) as covered_points
      FROM rail_point_overrides
      GROUP BY segment_id
    ) o ON o.segment_id = rl.id
    WHERE (p_country IS NULL OR rl.country = p_country)
  )
  SELECT json_build_object(
    'summary', (
      SELECT json_build_object(
        'total_segments', COUNT(*),
        'total_points', SUM(total_points)::int,
        'covered_points', SUM(covered_points)::int,
        'coverage_pct', ROUND(
          SUM(covered_points)::numeric / NULLIF(SUM(total_points), 0) * 100, 1
        ),
        'total_length_km', ROUND(SUM(length_m)::numeric / 1000, 1)
      )
      FROM segment_stats
    ),
    'lines', (
      SELECT COALESCE(json_agg(line_data ORDER BY coverage_pct ASC NULLS FIRST), '[]'::json)
      FROM (
        SELECT
          line_ref,
          MAX(line_desc) as description,
          COUNT(*) as segment_count,
          SUM(total_points)::int as total_points,
          SUM(covered_points)::int as covered_points,
          ROUND(
            SUM(covered_points)::numeric / NULLIF(SUM(total_points), 0) * 100, 1
          ) as coverage_pct,
          ROUND(SUM(length_m)::numeric / 1000, 1) as length_km
        FROM segment_stats
        WHERE line_ref IS NOT NULL
        GROUP BY line_ref
      ) line_data
    )
  );
$$;
