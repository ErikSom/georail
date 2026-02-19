CREATE OR REPLACE FUNCTION get_station_coords_batch(
  codes text[],
  p_country text DEFAULT NULL
)
RETURNS TABLE(code text, lon float, lat float)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT DISTINCT ON (s.code)
    s.code,
    ST_X(s.geom)::float AS lon,
    ST_Y(s.geom)::float AS lat
  FROM stations s
  WHERE s.code = ANY(codes)
    AND (p_country IS NULL OR s.country = p_country)
  ORDER BY s.code;
$$;
