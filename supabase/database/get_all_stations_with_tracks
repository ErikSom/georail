CREATE OR REPLACE FUNCTION get_all_stations_with_tracks()
RETURNS json
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    json_agg(
      json_build_object(
        'name',
        name,
        'tracks',
        -- Aggregate all unique, non-null track numbers into a JSON array
        (
          SELECT
            json_agg(DISTINCT ref)
          FROM
            public.stations s2
          WHERE
            s2.name = s1.name
            AND s2.ref IS NOT NULL
        )
      )
      ORDER BY name
    )
  FROM
    (
      -- Get all unique station names
      SELECT
        DISTINCT name
      FROM
        public.stations
    ) s1;
$$;