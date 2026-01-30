CREATE OR REPLACE FUNCTION get_all_stations_with_tracks()
RETURNS json
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    json_agg(
      json_build_object(
        'name', name,
        'code', code,
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
      json_agg(DISTINCT ref) FILTER (WHERE ref IS NOT NULL AND ref != '') as tracks_list
    FROM 
      public.stations 
    WHERE 
      code IS NOT NULL AND code != ''
    GROUP BY 
      name
  ) s1;
$$;