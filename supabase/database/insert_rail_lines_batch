
  INSERT INTO rail_lines (properties, geom)
  SELECT
    (f->>'properties')::jsonb,
    ST_GeomFromGeoJSON(f->'geometry')
  FROM jsonb_array_elements(features) AS f
  -- ADD THIS LINE TO FILTER FOR LINESTRINGS ONLY:
  WHERE f->'geometry'->>'type' = 'LineString';
