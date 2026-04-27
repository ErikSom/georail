CREATE OR REPLACE FUNCTION get_all_stations_with_tracks(
  p_country text DEFAULT NULL
)
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    json_agg(
      json_build_object(
        'name', name,
        'code', code,
        'country', country,
        'lat', lat,
        'lon', lon,
        'tracks', CASE
            -- Check if the result is null or an empty array using JSONB
            WHEN tracks_list IS NULL OR tracks_list::jsonb = '[]'::jsonb
            THEN json_build_array('1')
            ELSE tracks_list
          END
      )
      ORDER BY name
    )
  FROM (
    SELECT
      name,
      MAX(code) as code,
      MAX(country) as country,
      ST_Y(ST_Centroid(ST_Collect(geom))) as lat,
      ST_X(ST_Centroid(ST_Collect(geom))) as lon,
      json_agg(DISTINCT ref) FILTER (WHERE ref IS NOT NULL AND ref != '') as tracks_list
    FROM
      public.stations
    WHERE
      code IS NOT NULL AND code != ''
      AND (p_country IS NULL OR country = p_country)
    GROUP BY
      name
  ) s1;
$$;
