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

  -- Optimization: cache previous segment's end for reuse as next start
  prev_end_coords float[];
  prev_end_node bigint;

  segment_route json;
  segment_editor json;
  all_routes json[] := ARRAY[]::json[];
  all_editor json[] := ARRAY[]::json[];
  combined_route json;
  combined_editor json;

  -- Metadata for timing calculations
  segment_metadata json;
  all_metadata json[] := ARRAY[]::json[];
  combined_metadata json;
  running_point_count int := 0;
  stop_indices int[] := ARRAY[0]::int[];  -- First stop is always at index 0

  -- Security: distance tracking (straight-line between stops)
  MAX_DISTANCE_METERS float := 500000; -- 500 km total
  MAX_SEGMENT_METERS float := 150000; -- 150 km per stop
  total_distance float := 0;
  segment_distance float;

  -- Security: direction change detection
  all_traversed_edges jsonb := '{}'; -- accumulated { "edge_id": "forward" | "reverse" }
  segment_edges jsonb; -- edges for current segment
  direction_conflicts int;
BEGIN
  stop_count := jsonb_array_length(stops);

  IF stop_count < 2 THEN
    RETURN json_build_object('error', 'At least 2 stops required');
  END IF;

  -- Loop through consecutive pairs of stops
  FOR i IN 0..(stop_count - 2) LOOP
    current_stop := stops->i;
    next_stop := stops->(i + 1);

    -- OPTIMIZATION: Reuse previous segment's end as this segment's start
    IF i > 0 AND prev_end_coords IS NOT NULL THEN
      start_coords := prev_end_coords;
      start_node := prev_end_node;
    ELSE
      -- First segment: look up start station coordinates
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

      -- Find start_node
      SELECT v.id INTO start_node
      FROM rail_lines_vertices_pgr v
      ORDER BY v.the_geom <-> ST_Transform(
        ST_SetSRID(ST_MakePoint(start_coords[1], start_coords[2]), 4326),
        ST_SRID(v.the_geom)
      )
      LIMIT 1;
    END IF;

    -- Find end station coordinates (always needed)
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

    -- Find end_node
    SELECT v.id INTO end_node
    FROM rail_lines_vertices_pgr v
    ORDER BY v.the_geom <-> ST_Transform(
      ST_SetSRID(ST_MakePoint(end_coords[1], end_coords[2]), 4326),
      ST_SRID(v.the_geom)
    )
    LIMIT 1;

    -- SECURITY: Calculate straight-line distance and check caps BEFORE pathfinding
    segment_distance := ST_Distance(
      ST_SetSRID(ST_MakePoint(start_coords[1], start_coords[2]), 4326)::geography,
      ST_SetSRID(ST_MakePoint(end_coords[1], end_coords[2]), 4326)::geography
    );

    IF segment_distance > MAX_SEGMENT_METERS THEN
      RETURN json_build_object('error', format('Distance between stops exceeds maximum of %s km', (MAX_SEGMENT_METERS / 1000)::int));
    END IF;

    total_distance := total_distance + segment_distance;

    IF total_distance > MAX_DISTANCE_METERS THEN
      RETURN json_build_object('error', format('Journey exceeds maximum distance of %s km', (MAX_DISTANCE_METERS / 1000)::int));
    END IF;

    -- Store first/last nodes
    IF i = 0 THEN
      first_start_node := start_node;
    END IF;
    IF i = stop_count - 2 THEN
      last_end_node := end_node;
    END IF;

    -- Cache end coords/node for next iteration
    prev_end_coords := end_coords;
    prev_end_node := end_node;

    -- Calculate route for this segment - single Dijkstra call with all security checks
    WITH
    d AS ( -- 1. Dijkstra results (called once, reused for everything)
      SELECT * FROM pgr_dijkstra(
        'SELECT id, source, target, length_m AS cost FROM rail_lines',
        start_node, end_node, false
      )
    ),
    segment_info AS ( -- 2. Track edge directions for direction change detection
      SELECT
        jsonb_object_agg(
          di.edge::text,
          CASE WHEN di.node = rl.source THEN 'forward' ELSE 'reverse' END
        ) AS seg_edges
      FROM d di
      JOIN rail_lines rl ON rl.id = di.edge
      WHERE di.edge <> -1
    ),
    ordered_segments AS ( -- 3. Get ordered segments for route building
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
    route_points_base AS ( -- 4a. Get points and calculate original index
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
    final_points_data AS ( -- 4b. Join overrides and get all raw data
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
        ) AS world_offset,
        -- Get maxspeed from rail_lines properties (default 0 km/h if null)
        COALESCE((rl.properties->>'maxspeed')::int, 0) AS max_speed
      FROM route_points_base b
      LEFT JOIN rail_point_overrides ovr
        ON ovr.segment_id = b.segment_id
        AND ovr.point_index = b.original_point_index
      JOIN rail_lines rl
        ON rl.id = b.segment_id
    ),
    combined_arrays AS ( -- 5. Build all arrays in single pass
      SELECT
        json_agg(
          json_build_array(
            ST_X(fp.point_geom_2d),
            ST_Y(fp.point_geom_2d),
            fp.world_offset[1],  -- x
            fp.world_offset[2],  -- y (height)
            fp.world_offset[3]   -- z
          )
          ORDER BY fp.path_seq, fp.point_index_in_route
        ) AS route_arr,
        json_agg(
          json_build_object(
            'segment_id', fp.segment_id,
            'index', fp.original_point_index
          )
          ORDER BY fp.path_seq, fp.point_index_in_route
        ) AS editor_arr,
        json_agg(
          json_build_object(
            'max_speed', fp.max_speed
          )
          ORDER BY fp.path_seq, fp.point_index_in_route
        ) AS metadata_arr
      FROM final_points_data AS fp
    )
    SELECT
      ca.route_arr,
      ca.editor_arr,
      si.seg_edges,
      ca.metadata_arr
    INTO segment_route, segment_editor, segment_edges, segment_metadata
    FROM combined_arrays ca, segment_info si;

    -- SECURITY: Check for direction conflicts (traversing same edge in opposite direction)
    IF segment_edges IS NOT NULL THEN
      SELECT COUNT(*) INTO direction_conflicts
      FROM jsonb_each_text(segment_edges) se
      WHERE all_traversed_edges ? se.key
        AND all_traversed_edges->>se.key <> se.value;

      IF direction_conflicts > 0 THEN
        RETURN json_build_object('error', 'Invalid route: direction change detected. The train cannot reverse direction on the same track.');
      END IF;

      -- Merge segment edges into accumulated edges
      all_traversed_edges := all_traversed_edges || segment_edges;
    END IF;

    -- Add this segment's route, editor, and metadata to our collections
    IF segment_route IS NOT NULL THEN
      all_routes := array_append(all_routes, segment_route);
      all_editor := array_append(all_editor, segment_editor);
      all_metadata := array_append(all_metadata, segment_metadata);

      -- Track stop indices: after this segment, the next stop is at the end
      -- For segments after the first, we skip the first point (duplicate), so subtract 1
      IF i = 0 THEN
        running_point_count := running_point_count + json_array_length(segment_route);
      ELSE
        running_point_count := running_point_count + json_array_length(segment_route) - 1;
      END IF;
      stop_indices := array_append(stop_indices, running_point_count - 1);
    END IF;
  END LOOP;

  -- Combine all route segments into one array, skipping duplicate points at segment boundaries
  SELECT json_agg(point ORDER BY seg_idx, point_idx)
  INTO combined_route
  FROM (
    SELECT point, point_idx, seg_idx
    FROM unnest(all_routes) WITH ORDINALITY AS segments(route_segment, seg_idx),
    LATERAL json_array_elements(route_segment) WITH ORDINALITY AS points(point, point_idx)
  ) subq
  WHERE seg_idx = 1 OR point_idx > 1;  -- Keep all points from first segment, skip first point of subsequent segments

  -- Combine all editor segments into one array (only if editor mode)
  IF editor THEN
    SELECT json_agg(point ORDER BY seg_idx, point_idx)
    INTO combined_editor
    FROM (
      SELECT point, point_idx, seg_idx
      FROM unnest(all_editor) WITH ORDINALITY AS segments(editor_segment, seg_idx),
      LATERAL json_array_elements(editor_segment) WITH ORDINALITY AS points(point, point_idx)
    ) subq
    WHERE seg_idx = 1 OR point_idx > 1;
  END IF;

  -- Combine all metadata segments into one array
  SELECT json_agg(point ORDER BY seg_idx, point_idx)
  INTO combined_metadata
  FROM (
    SELECT point, point_idx, seg_idx
    FROM unnest(all_metadata) WITH ORDINALITY AS segments(metadata_segment, seg_idx),
    LATERAL json_array_elements(metadata_segment) WITH ORDINALITY AS points(point, point_idx)
  ) subq
  WHERE seg_idx = 1 OR point_idx > 1;

  -- Return in same format as find_rail_route
  IF editor THEN
    RETURN json_build_object(
      'start_node', first_start_node,
      'end_node', last_end_node,
      'route', combined_route,
      'metadata', combined_metadata,
      'stop_indices', stop_indices,
      'editor', combined_editor
    );
  ELSE
    RETURN json_build_object(
      'start_node', first_start_node,
      'end_node', last_end_node,
      'route', combined_route,
      'metadata', combined_metadata,
      'stop_indices', stop_indices
    );
  END IF;
END;
$$;
