CREATE OR REPLACE FUNCTION insert_rail_lines_batch(
  features jsonb,
  p_country text DEFAULT 'NL'
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  INSERT INTO rail_lines (properties, geom, country)
  SELECT
    (f->>'properties')::jsonb,
    ST_GeomFromGeoJSON(f->'geometry'),
    p_country
  FROM jsonb_array_elements(features) AS f
  WHERE f->'geometry'->>'type' = 'LineString';
$$;
