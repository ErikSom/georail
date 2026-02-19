CREATE OR REPLACE FUNCTION insert_stations_batch(
  stations_data jsonb,
  p_country text DEFAULT 'NL'
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  INSERT INTO stations (name, ref, properties, geom, country)
  SELECT
    s->>'name',
    s->>'ref',
    (s->>'properties')::jsonb,
    ST_GeomFromGeoJSON(s->'geom_geojson'),
    p_country
  FROM jsonb_array_elements(stations_data) AS s;
$$;
