CREATE OR REPLACE FUNCTION get_station_coords_batch(codes text[])
RETURNS TABLE(code text, lon float, lat float)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT DISTINCT ON (s.code)
    s.code,
    ST_X(s.geom)::float AS lon,
    ST_Y(s.geom)::float AS lat
  FROM stations s
  WHERE s.code = ANY(codes)
  ORDER BY s.code;
$$;
