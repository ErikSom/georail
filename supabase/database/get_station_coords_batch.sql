CREATE OR REPLACE FUNCTION get_station_coords_batch(
  codes text[],
  tracks text[] DEFAULT NULL,
  p_country text DEFAULT NULL
)
RETURNS TABLE(code text, lon float, lat float)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT DISTINCT ON (idx)
    codes[idx] AS code,
    ST_X(s.geom)::float AS lon,
    ST_Y(s.geom)::float AS lat
  FROM generate_subscripts(codes, 1) AS idx
  JOIN stations s ON lower(s.code) = lower(codes[idx])
    AND (p_country IS NULL OR s.country = p_country)
    AND (tracks IS NULL OR tracks[idx] IS NULL OR s.ref = tracks[idx] OR s.ref ILIKE tracks[idx] || '%')
  ORDER BY idx;
$$;
