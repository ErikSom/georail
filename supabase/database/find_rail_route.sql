CREATE OR REPLACE FUNCTION find_rail_route(
  start_lon float,
  start_lat float,
  end_lon float,
  end_lat float,
  editor boolean DEFAULT false
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  start_node bigint;
  end_node   bigint;
  out_json   json;
BEGIN
  -- Find start_node
  SELECT v.id INTO start_node
  FROM rail_lines_vertices_pgr v
  ORDER BY v.the_geom <-> ST_Transform(ST_SetSRID(ST_MakePoint(start_lon, start_lat),4326), ST_SRID(v.the_geom))
  LIMIT 1;

  -- Find end_node
  SELECT v.id INTO end_node
  FROM rail_lines_vertices_pgr v
  ORDER BY v.the_geom <-> ST_Transform(ST_SetSRID(ST_MakePoint(end_lon, end_lat),4326), ST_SRID(v.the_geom))
  LIMIT 1;

  WITH
  d AS ( -- 1. Dijkstra results
    SELECT * FROM pgr_dijkstra(
      $pgr$SELECT id, source, target, ST_Length(geom::geography) AS cost FROM rail_lines$pgr$,
      start_node, end_node, false
    )
  ),
  ordered_segments AS ( -- 2. Get ordered segments
    SELECT
      di.path_seq,
      rl.id AS segment_id,
      rl.geom AS original_geom,
      CASE
        WHEN di.node = rl.source THEN false
        ELSE true
      END AS is_reversed,
      CASE
        WHEN di.node = rl.source THEN rl.geom
        ELSE ST_Reverse(rl.geom)
      END AS geom_dir
    FROM d AS di
    JOIN rail_lines AS rl ON rl.id = di.edge
    WHERE di.edge <> -1
  ),
  route_points_base AS ( -- 3a. Get points and calculate original index
    SELECT
      s.path_seq,
      s.segment_id,
      s.is_reversed,
      (dump).path[1] AS point_index_in_route,
      (dump).geom AS original_point_geom,
      CASE
        WHEN s.is_reversed THEN ST_NPoints(s.original_geom) - (dump).path[1]
        ELSE (dump).path[1] - 1
      END AS original_point_index
    FROM ordered_segments s,
    LATERAL ST_DumpPoints(s.geom_dir) AS dump
  ),
  final_points_data AS ( -- 3b. Join overrides and get all raw data
    SELECT
      b.path_seq,
      b.point_index_in_route,
      b.original_point_index,
      b.segment_id,
      b.is_reversed,

      -- Get 2D point for GeoJSON
      ST_MakePoint(
        ST_X(b.original_point_geom),
        ST_Y(b.original_point_geom)
      ) AS point_geom_2d,

      -- Get world_offset array [x, y, z]
      COALESCE(
        ovr.world_offset,
        ARRAY[0.0, COALESCE(ST_Z(b.original_point_geom), 0.0), 0.0]::double precision[]
      ) AS world_offset

    FROM route_points_base b
    LEFT JOIN rail_point_overrides ovr
      ON ovr.segment_id = b.segment_id
      AND ovr.point_index = b.original_point_index
  )
  -- 4. Build route/editor arrays
  , route_array AS (
    SELECT json_agg(
      json_build_array(
        ST_X(fp.point_geom_2d),
        ST_Y(fp.point_geom_2d),
        fp.world_offset[1],  -- x
        fp.world_offset[2],  -- y (height)
        fp.world_offset[3]   -- z
      )
      ORDER BY fp.path_seq, fp.point_index_in_route
    ) AS arr
    FROM final_points_data AS fp
  )
  , editor_array AS (
    SELECT json_agg(
      json_build_object(
        'segment_id', fp.segment_id,
        'index', fp.original_point_index
      )
      ORDER BY fp.path_seq, fp.point_index_in_route
    ) AS arr
    FROM final_points_data AS fp
  )
  -- 5. Build final JSON using CASE
  SELECT
    CASE
      WHEN editor = true THEN
        -- "Editor Mode"
        json_build_object(
          'start_node', start_node,
          'end_node',   end_node,
          'route',      r.arr,
          'editor',     e.arr
        )
      ELSE
        -- "User Mode"
        json_build_object(
          'start_node', start_node,
          'end_node',   end_node,
          'route',      r.arr
        )
    END
  INTO out_json
  FROM route_array r, editor_array e;

  RETURN out_json;
END;
$$;
