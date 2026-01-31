-- Function to find a route for an entire journey (multiple stops)
-- Input: JSONB array of stops, each with { code: string, track?: string }
-- Output: Combined route geometry for the whole journey
--
-- This reuses the same routing logic as find_rail_route but chains multiple
-- station-to-station segments together.

CREATE OR REPLACE FUNCTION find_journey_route(
  stops jsonb,
  editor boolean DEFAULT false
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  i int;
  stop_count int;
  current_stop jsonb;
  next_stop jsonb;

  start_coords float[];
  end_coords float[];

  start_node bigint;
  end_node bigint;
  first_start_node bigint;
  last_end_node bigint;

  segment_route json;
  segment_editor json;
  all_routes json[] := ARRAY[]::json[];
  all_editor json[] := ARRAY[]::json[];
  combined_route json;
  combined_editor json;
BEGIN
  stop_count := jsonb_array_length(stops);

  IF stop_count < 2 THEN
    RETURN json_build_object('error', 'At least 2 stops required');
  END IF;

  -- Loop through consecutive pairs of stops
  FOR i IN 0..(stop_count - 2) LOOP
    current_stop := stops->i;
    next_stop := stops->(i + 1);

    -- Find start station coordinates (lookup by code)
    SELECT ARRAY[
      ST_X(geom),
      ST_Y(geom)
    ] INTO start_coords
    FROM stations
    WHERE code = current_stop->>'code'
      AND (current_stop->>'track' IS NULL OR ref = current_stop->>'track')
    LIMIT 1;

    IF start_coords IS NULL THEN
      RETURN json_build_object('error', format('Station not found: %s', current_stop->>'code'));
    END IF;

    -- Find end station coordinates (lookup by code)
    SELECT ARRAY[
      ST_X(geom),
      ST_Y(geom)
    ] INTO end_coords
    FROM stations
    WHERE code = next_stop->>'code'
      AND (next_stop->>'track' IS NULL OR ref = next_stop->>'track')
    LIMIT 1;

    IF end_coords IS NULL THEN
      RETURN json_build_object('error', format('Station not found: %s', next_stop->>'code'));
    END IF;

    -- Find start_node (same as find_rail_route)
    SELECT v.id INTO start_node
    FROM rail_lines_vertices_pgr v
    ORDER BY v.the_geom <-> ST_Transform(
      ST_SetSRID(ST_MakePoint(start_coords[1], start_coords[2]), 4326),
      ST_SRID(v.the_geom)
    )
    LIMIT 1;

    -- Find end_node (same as find_rail_route)
    SELECT v.id INTO end_node
    FROM rail_lines_vertices_pgr v
    ORDER BY v.the_geom <-> ST_Transform(
      ST_SetSRID(ST_MakePoint(end_coords[1], end_coords[2]), 4326),
      ST_SRID(v.the_geom)
    )
    LIMIT 1;

    -- Store first/last nodes
    IF i = 0 THEN
      first_start_node := start_node;
    END IF;
    IF i = stop_count - 2 THEN
      last_end_node := end_node;
    END IF;

    -- Calculate route for this segment (same CTEs as find_rail_route)
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
    ),
    route_array AS ( -- 4. Build route array
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
    ),
    editor_array AS ( -- 5. Build editor array (segment_id + index for each point)
      SELECT json_agg(
        json_build_object(
          'segment_id', fp.segment_id,
          'index', fp.original_point_index
        )
        ORDER BY fp.path_seq, fp.point_index_in_route
      ) AS arr
      FROM final_points_data AS fp
    )
    SELECT r.arr, e.arr INTO segment_route, segment_editor FROM route_array r, editor_array e;

    -- Add this segment's route and editor data to our collections
    IF segment_route IS NOT NULL THEN
      all_routes := array_append(all_routes, segment_route);
      all_editor := array_append(all_editor, segment_editor);
    END IF;
  END LOOP;

  -- Combine all route segments into one array
  SELECT json_agg(point)
  INTO combined_route
  FROM (
    SELECT json_array_elements(route_segment) AS point
    FROM unnest(all_routes) AS route_segment
  ) subq;

  -- Combine all editor segments into one array (only if editor mode)
  IF editor THEN
    SELECT json_agg(point)
    INTO combined_editor
    FROM (
      SELECT json_array_elements(editor_segment) AS point
      FROM unnest(all_editor) AS editor_segment
    ) subq;
  END IF;

  -- Return in same format as find_rail_route
  IF editor THEN
    RETURN json_build_object(
      'start_node', first_start_node,
      'end_node', last_end_node,
      'route', combined_route,
      'editor', combined_editor
    );
  ELSE
    RETURN json_build_object(
      'start_node', first_start_node,
      'end_node', last_end_node,
      'route', combined_route
    );
  END IF;
END;
$$;
