CREATE OR REPLACE FUNCTION find_journey_route(
  stops jsonb,
  editor boolean DEFAULT false
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
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
  stop_indices int[] := ARRAY[0]::int[];

  -- Security: distance tracking (limits raised for cross-border routing)
  MAX_DISTANCE_METERS float := 1500000;
  MAX_SEGMENT_METERS float := 800000;
  total_distance float := 0;
  segment_distance float;

  -- Reversal detection
  prev_segment_azimuth float;
  curr_segment_azimuth float;
  angle_diff float;
  MIN_REVERSAL_ANGLE float := 2.618;

  -- FIX: Helper variable for regex construction
  track_regex text;
BEGIN
  stop_count := jsonb_array_length(stops);

  IF stop_count < 2 THEN
    RETURN json_build_object('error', 'At least 2 stops required');
  END IF;

  FOR i IN 0..(stop_count - 2) LOOP
    current_stop := stops->i;
    next_stop := stops->(i + 1);

    -- 1. DETERMINE START NODE
    IF i > 0 AND prev_end_coords IS NOT NULL THEN
      start_coords := prev_end_coords;
      start_node := prev_end_node;
    ELSE
      -- Primary lookup: Exact code + optional track match
      SELECT ARRAY[ST_X(geom), ST_Y(geom)] INTO start_coords
      FROM stations
      WHERE code = current_stop->>'code'
        AND (current_stop->>'track' IS NULL OR ref = current_stop->>'track')
      LIMIT 1;

      -- Fallback: Regex match (e.g. track "6" matches "6A")
      IF start_coords IS NULL AND current_stop->>'track' IS NOT NULL THEN
        -- FIX: Build regex using format() to prevent parser errors
        track_regex := format('^%s[^0-9]', current_stop->>'track');
        
        SELECT ARRAY[ST_X(geom), ST_Y(geom)] INTO start_coords
        FROM stations
        WHERE code = current_stop->>'code'
          AND ref ~ track_regex
        LIMIT 1;
      END IF;

      IF start_coords IS NULL THEN
        RETURN json_build_object('error', format('Station not found: %s', current_stop->>'code'));
      END IF;

      -- Find start_node on network
      SELECT v.id INTO start_node
      FROM rail_lines_vertices_pgr v
      ORDER BY v.the_geom <-> ST_Transform(
        ST_SetSRID(ST_MakePoint(start_coords[1], start_coords[2]), 4326),
        ST_SRID(v.the_geom)
      )
      LIMIT 1;
    END IF;

    -- 2. DETERMINE END NODE
    SELECT ARRAY[ST_X(geom), ST_Y(geom)] INTO end_coords
    FROM stations
    WHERE code = next_stop->>'code'
      AND (next_stop->>'track' IS NULL OR ref = next_stop->>'track')
    LIMIT 1;

    -- Fallback: Regex match for end station
    IF end_coords IS NULL AND next_stop->>'track' IS NOT NULL THEN
      -- FIX: Build regex using format() to prevent parser errors
      track_regex := format('^%s[^0-9]', next_stop->>'track');

      SELECT ARRAY[ST_X(geom), ST_Y(geom)] INTO end_coords
      FROM stations
      WHERE code = next_stop->>'code'
        AND ref ~ track_regex
      LIMIT 1;
    END IF;

    IF end_coords IS NULL THEN
      RETURN json_build_object('error', format('Station not found: %s', next_stop->>'code'));
    END IF;

    -- Find end_node on network
    SELECT v.id INTO end_node
    FROM rail_lines_vertices_pgr v
    ORDER BY v.the_geom <-> ST_Transform(
      ST_SetSRID(ST_MakePoint(end_coords[1], end_coords[2]), 4326),
      ST_SRID(v.the_geom)
    )
    LIMIT 1;

    -- 3. DISTANCE CHECKS
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

    -- 4. REVERSAL CHECKS
    curr_segment_azimuth := ST_Azimuth(
      ST_SetSRID(ST_MakePoint(start_coords[1], start_coords[2]), 4326),
      ST_SetSRID(ST_MakePoint(end_coords[1], end_coords[2]), 4326)
    );

    IF i > 0 AND prev_segment_azimuth IS NOT NULL THEN
      angle_diff := abs(prev_segment_azimuth - curr_segment_azimuth);
      IF angle_diff > pi() THEN
        angle_diff := 2 * pi() - angle_diff;
      END IF;

      IF angle_diff > MIN_REVERSAL_ANGLE THEN
        RETURN json_build_object(
          'error', format(
            'Invalid route: reversal detected at stop %s (%s).',
            i + 1, current_stop->>'code'
          )
        );
      END IF;
    END IF;

    prev_segment_azimuth := curr_segment_azimuth;

    -- Store nodes and cache for next loop
    IF i = 0 THEN first_start_node := start_node; END IF;
    IF i = stop_count - 2 THEN last_end_node := end_node; END IF;
    prev_end_coords := end_coords;
    prev_end_node := end_node;

    -- 5. ROUTING (DIJKSTRA)
    WITH
    d AS (
      SELECT * FROM pgr_dijkstra(
        'SELECT id, source, target, length_m AS cost FROM rail_lines',
        start_node, end_node, false
      )
    ),
    ordered_segments AS (
      SELECT
        di.path_seq,
        rl.id AS segment_id,
        rl.geom AS original_geom,
        CASE WHEN di.node = rl.source THEN false ELSE true END AS is_reversed,
        CASE WHEN di.node = rl.source THEN rl.geom ELSE ST_Reverse(rl.geom) END AS geom_dir
      FROM d AS di
      JOIN rail_lines AS rl ON rl.id = di.edge
      WHERE di.edge <> -1
    ),
    route_points_base AS (
      SELECT
        s.path_seq,
        s.segment_id,
        s.is_reversed,
        (dump).path[1] AS point_index_in_route,
        (dump).geom AS original_point_geom,
        CASE WHEN s.is_reversed THEN ST_NPoints(s.original_geom) - (dump).path[1] ELSE (dump).path[1] - 1 END AS original_point_index
      FROM ordered_segments s,
      LATERAL ST_DumpPoints(s.geom_dir) AS dump
    ),
    final_points_data AS (
      SELECT
        b.path_seq,
        b.point_index_in_route,
        b.original_point_index,
        b.segment_id,
        ST_MakePoint(ST_X(b.original_point_geom), ST_Y(b.original_point_geom)) AS point_geom_2d,
        COALESCE(ovr.world_offset, ARRAY[0.0, COALESCE(ST_Z(b.original_point_geom), 0.0), 0.0]::double precision[]) AS world_offset,
        COALESCE((rl.properties->>'maxspeed')::int, 0) AS max_speed
      FROM route_points_base b
      LEFT JOIN rail_point_overrides ovr ON ovr.segment_id = b.segment_id AND ovr.point_index = b.original_point_index
      JOIN rail_lines rl ON rl.id = b.segment_id
    ),
    combined_arrays AS (
      SELECT
        json_agg(json_build_array(ST_X(fp.point_geom_2d), ST_Y(fp.point_geom_2d), fp.world_offset[1], fp.world_offset[2], fp.world_offset[3]) ORDER BY fp.path_seq, fp.point_index_in_route) AS route_arr,
        json_agg(json_build_object('segment_id', fp.segment_id, 'index', fp.original_point_index) ORDER BY fp.path_seq, fp.point_index_in_route) AS editor_arr,
        json_agg(json_build_object('max_speed', fp.max_speed) ORDER BY fp.path_seq, fp.point_index_in_route) AS metadata_arr
      FROM final_points_data AS fp
    )
    SELECT ca.route_arr, ca.editor_arr, ca.metadata_arr
    INTO segment_route, segment_editor, segment_metadata
    FROM combined_arrays ca;

    -- Append to collections
    IF segment_route IS NOT NULL THEN
      all_routes := array_append(all_routes, segment_route);
      all_editor := array_append(all_editor, segment_editor);
      all_metadata := array_append(all_metadata, segment_metadata);

      IF i = 0 THEN
        running_point_count := running_point_count + json_array_length(segment_route);
      ELSE
        running_point_count := running_point_count + json_array_length(segment_route) - 1;
      END IF;
      stop_indices := array_append(stop_indices, running_point_count - 1);
    END IF;
  END LOOP;

  -- 6. AGGREGATE FINAL RESULT
  SELECT json_agg(point ORDER BY seg_idx, point_idx) INTO combined_route
  FROM (
    SELECT point, point_idx, seg_idx
    FROM unnest(all_routes) WITH ORDINALITY AS segments(route_segment, seg_idx),
    LATERAL json_array_elements(route_segment) WITH ORDINALITY AS points(point, point_idx)
  ) subq WHERE seg_idx = 1 OR point_idx > 1;

  IF editor THEN
    SELECT json_agg(point ORDER BY seg_idx, point_idx) INTO combined_editor
    FROM (
      SELECT point, point_idx, seg_idx
      FROM unnest(all_editor) WITH ORDINALITY AS segments(editor_segment, seg_idx),
      LATERAL json_array_elements(editor_segment) WITH ORDINALITY AS points(point, point_idx)
    ) subq WHERE seg_idx = 1 OR point_idx > 1;
  END IF;

  SELECT json_agg(point ORDER BY seg_idx, point_idx) INTO combined_metadata
  FROM (
    SELECT point, point_idx, seg_idx
    FROM unnest(all_metadata) WITH ORDINALITY AS segments(metadata_segment, seg_idx),
    LATERAL json_array_elements(metadata_segment) WITH ORDINALITY AS points(point, point_idx)
  ) subq WHERE seg_idx = 1 OR point_idx > 1;

  IF editor THEN
    RETURN json_build_object(
      'start_node', first_start_node, 'end_node', last_end_node,
      'route', combined_route, 'metadata', combined_metadata,
      'stop_indices', stop_indices, 'editor', combined_editor
    );
  ELSE
    RETURN json_build_object(
      'start_node', first_start_node, 'end_node', last_end_node,
      'route', combined_route, 'metadata', combined_metadata, 'stop_indices', stop_indices
    );
  END IF;
END;
$$;