
  INSERT INTO stations (name, ref, properties, geom)
  SELECT
    -- Extract specific fields for the columns
    s->>'name',
    s->>'ref',
    (s->>'properties')::jsonb,
    ST_GeomFromGeoJSON(s->'geom_geojson')
  -- This 'un-nests' the JSON array from your script into a set of rows
  FROM jsonb_array_elements(stations_data) AS s;
