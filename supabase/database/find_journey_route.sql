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

  -- Station projected onto nearest rail edge (virtual graph vertex)
  start_edge_id bigint;
  end_edge_id bigint;
  start_fraction float;
  end_fraction float;

  first_start_edge_id bigint;
  first_start_fraction float;
  last_end_edge_id bigint;
  last_end_fraction float;

  -- Optimization: cache previous segment's end for reuse as next start
  prev_end_coords float[];
  prev_end_edge_id bigint;
  prev_end_fraction float;

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

  -- pgr_withPointsDijkstra parameters
  points_sql text;

  -- Post-processing: snap stops to closest existing route point
  all_stop_lons float[] := ARRAY[]::float[];
  all_stop_lats float[] := ARRAY[]::float[];
  snap_best_d float8;
  snap_best_j int;
  snap_d float8;
  snap_p jsonb;
  s int;
  j int;
BEGIN
  -- Long multi-stop journeys (28+ stops) loop pgr_withPoints per pair and can
  -- exceed the role-default 8s statement_timeout. SET LOCAL overrides it for
  -- this transaction only, regardless of pool/role config.
  SET LOCAL statement_timeout = '60s';

  stop_count := jsonb_array_length(stops);

  IF stop_count < 2 THEN
    RETURN json_build_object('error', 'At least 2 stops required');
  END IF;

  FOR i IN 0..(stop_count - 2) LOOP
    current_stop := stops->i;
    next_stop := stops->(i + 1);

    -- 1. DETERMINE START (virtual point on nearest rail edge)
    IF i > 0 AND prev_end_coords IS NOT NULL THEN
      start_coords := prev_end_coords;
      start_edge_id := prev_end_edge_id;
      start_fraction := prev_end_fraction;
    ELSE
      -- Primary lookup: Exact code + optional track match
      SELECT ARRAY[ST_X(geom), ST_Y(geom)] INTO start_coords
      FROM stations
      WHERE code = current_stop->>'code'
        AND (current_stop->>'track' IS NULL OR ref = current_stop->>'track')
      LIMIT 1;

      -- Fallback: Regex match (e.g. track "6" matches "6A")
      IF start_coords IS NULL AND current_stop->>'track' IS NOT NULL THEN
        track_regex := format('^%s[^0-9]', current_stop->>'track');

        SELECT ARRAY[ST_X(geom), ST_Y(geom)] INTO start_coords
        FROM stations
        WHERE code = current_stop->>'code'
          AND ref ~ track_regex
        LIMIT 1;
      END IF;

      -- Last-resort fallback: station-level row (ref IS NULL) for stations that
      -- OSM only maps as a single point rather than per-platform stops. The
      -- user's track preference can't be honoured, but the journey still runs.
      IF start_coords IS NULL THEN
        SELECT ARRAY[ST_X(geom), ST_Y(geom)] INTO start_coords
        FROM stations
        WHERE code = current_stop->>'code'
          AND ref IS NULL
        LIMIT 1;
      END IF;

      IF start_coords IS NULL THEN
        RETURN json_build_object('error', format('Station not found: %s', current_stop->>'code'));
      END IF;

      all_stop_lons := array_append(all_stop_lons, start_coords[1]);
      all_stop_lats := array_append(all_stop_lats, start_coords[2]);

      -- Find nearest edge to the station and project onto it
      SELECT
        rl.id,
        ST_LineLocatePoint(rl.geom, ST_SetSRID(ST_MakePoint(start_coords[1], start_coords[2]), 4326))
      INTO start_edge_id, start_fraction
      FROM rail_lines rl
      ORDER BY rl.geom <-> ST_SetSRID(ST_MakePoint(start_coords[1], start_coords[2]), 4326)
      LIMIT 1;

      -- pgr_withPoints needs fractions strictly inside the edge (not at a vertex)
      start_fraction := GREATEST(0.0001, LEAST(0.9999, start_fraction));
    END IF;

    -- 2. DETERMINE END (virtual point on nearest rail edge)
    SELECT ARRAY[ST_X(geom), ST_Y(geom)] INTO end_coords
    FROM stations
    WHERE code = next_stop->>'code'
      AND (next_stop->>'track' IS NULL OR ref = next_stop->>'track')
    LIMIT 1;

    IF end_coords IS NULL AND next_stop->>'track' IS NOT NULL THEN
      track_regex := format('^%s[^0-9]', next_stop->>'track');
      SELECT ARRAY[ST_X(geom), ST_Y(geom)] INTO end_coords
      FROM stations
      WHERE code = next_stop->>'code'
        AND ref ~ track_regex
      LIMIT 1;
    END IF;

    -- Station-level fallback (see note on start lookup above).
    IF end_coords IS NULL THEN
      SELECT ARRAY[ST_X(geom), ST_Y(geom)] INTO end_coords
      FROM stations
      WHERE code = next_stop->>'code'
        AND ref IS NULL
      LIMIT 1;
    END IF;

    IF end_coords IS NULL THEN
      RETURN json_build_object('error', format('Station not found: %s', next_stop->>'code'));
    END IF;

    all_stop_lons := array_append(all_stop_lons, end_coords[1]);
    all_stop_lats := array_append(all_stop_lats, end_coords[2]);

    SELECT
      rl.id,
      ST_LineLocatePoint(rl.geom, ST_SetSRID(ST_MakePoint(end_coords[1], end_coords[2]), 4326))
    INTO end_edge_id, end_fraction
    FROM rail_lines rl
    ORDER BY rl.geom <-> ST_SetSRID(ST_MakePoint(end_coords[1], end_coords[2]), 4326)
    LIMIT 1;

    -- pgr_withPoints needs fractions strictly inside the edge (not at a vertex)
    end_fraction := GREATEST(0.0001, LEAST(0.9999, end_fraction));

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

    -- Store virtual-vertex info for final result / next iteration
    IF i = 0 THEN
      first_start_edge_id := start_edge_id;
      first_start_fraction := start_fraction;
    END IF;
    IF i = stop_count - 2 THEN
      last_end_edge_id := end_edge_id;
      last_end_fraction := end_fraction;
    END IF;
    prev_end_coords := end_coords;
    prev_end_edge_id := end_edge_id;
    prev_end_fraction := end_fraction;

    -- 5. ROUTING (DIJKSTRA WITH VIRTUAL POINTS)
    -- Two virtual points per segment: pid=1 (start), pid=2 (end). Negative pids below
    -- tell pgr_withPoints to route from/to the virtual points.
    points_sql := format(
      'SELECT 1::bigint AS pid, %s::bigint AS edge_id, %s::float AS fraction ' ||
      'UNION ALL SELECT 2::bigint, %s::bigint, %s::float',
      start_edge_id, start_fraction, end_edge_id, end_fraction
    );

    WITH
    d AS (
      SELECT * FROM pgr_withPoints(
        'SELECT id, source, target, length_m AS cost FROM rail_lines'::text,
        points_sql,
        (-1)::bigint, (-2)::bigint,
        false,        -- directed = false
        'b',          -- driving_side = 'b' (irrelevant when undirected)
        false         -- details = false
      )
    ),
    -- Build (from_node, edge_id, to_node) triples. LEAD must run over the full
    -- result (including the terminal row) so the last real edge knows its to_node
    -- is the virtual end point (-2). Filter terminal rows only after LEAD.
    path_edges AS (
      SELECT path_seq, from_node, to_node, edge_id
      FROM (
        SELECT
          di.path_seq,
          di.node AS from_node,
          LEAD(di.node) OVER (ORDER BY di.path_seq) AS to_node,
          di.edge AS edge_id
        FROM d di
      ) sub
      WHERE sub.edge_id <> -1
    ),
    ordered_segments AS (
      SELECT
        pe.path_seq,
        rl.id AS segment_id,
        rl.geom AS original_geom,
        -- Direction the edge is traversed in (used downstream for point indexing).
        CASE
          -- Same edge contains both start and end virtual points
          WHEN pe.from_node = -1 AND pe.to_node = -2 THEN start_fraction > end_fraction
          -- First edge: going from projection toward to_node (a real vertex)
          WHEN pe.from_node = -1 THEN pe.to_node = rl.source
          -- Last edge: going from from_node (a real vertex) toward projection
          WHEN pe.to_node = -2 THEN pe.from_node = rl.target
          -- Interior edges: direction follows current source/target
          ELSE pe.from_node <> rl.source
        END AS is_reversed,
        -- Trim first/last edges at projection fractions; interior edges use full geom.
        CASE
          WHEN pe.from_node = -1 AND pe.to_node = -2 THEN
            -- Same-edge segment: substring between the two projections, flipped if needed
            CASE
              WHEN start_fraction <= end_fraction
                THEN ST_LineSubstring(rl.geom, start_fraction, end_fraction)
              ELSE ST_Reverse(ST_LineSubstring(rl.geom, end_fraction, start_fraction))
            END
          WHEN pe.from_node = -1 THEN
            -- First edge: leave projection toward real vertex
            CASE
              WHEN pe.to_node = rl.target
                THEN ST_LineSubstring(rl.geom, start_fraction, 1)
              ELSE ST_Reverse(ST_LineSubstring(rl.geom, 0, start_fraction))
            END
          WHEN pe.to_node = -2 THEN
            -- Last edge: arrive at projection from real vertex
            CASE
              WHEN pe.from_node = rl.source
                THEN ST_LineSubstring(rl.geom, 0, end_fraction)
              ELSE ST_Reverse(ST_LineSubstring(rl.geom, end_fraction, 1))
            END
          ELSE
            CASE WHEN pe.from_node = rl.source THEN rl.geom ELSE ST_Reverse(rl.geom) END
        END AS geom_dir
      FROM path_edges pe
      JOIN rail_lines rl ON rl.id = pe.edge_id
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
        COALESCE((rl.properties->>'maxspeed')::int, 0) AS max_speed,
        ovr.source AS source
      FROM route_points_base b
      LEFT JOIN rail_point_overrides ovr ON ovr.segment_id = b.segment_id AND ovr.point_index = b.original_point_index
      JOIN rail_lines rl ON rl.id = b.segment_id
    ),
    combined_arrays AS (
      SELECT
        json_agg(json_build_array(ST_X(fp.point_geom_2d), ST_Y(fp.point_geom_2d), fp.world_offset[1], fp.world_offset[2], fp.world_offset[3]) ORDER BY fp.path_seq, fp.point_index_in_route) AS route_arr,
        json_agg(json_build_object('segment_id', fp.segment_id, 'index', fp.original_point_index) ORDER BY fp.path_seq, fp.point_index_in_route) AS editor_arr,
        json_agg(json_build_object('max_speed', fp.max_speed, 'source', fp.source) ORDER BY fp.path_seq, fp.point_index_in_route) AS metadata_arr
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

  -- 7. SNAP STOP INDICES: For each stop, find the closest
  --    existing route point to the actual station coordinates.
  IF combined_route IS NOT NULL AND array_length(all_stop_lons, 1) >= 2 THEN
    FOR s IN 1..array_length(all_stop_lons, 1) LOOP
      snap_best_d := float8 'infinity';
      snap_best_j := stop_indices[s];

      FOR j IN GREATEST(0, stop_indices[s] - 50)..LEAST(json_array_length(combined_route) - 1, stop_indices[s] + 50) LOOP
        snap_p := combined_route->j;
        snap_d := ST_Distance(
          ST_SetSRID(ST_MakePoint((snap_p->>0)::float8, (snap_p->>1)::float8), 4326),
          ST_SetSRID(ST_MakePoint(all_stop_lons[s], all_stop_lats[s]), 4326)
        );
        IF snap_d < snap_best_d THEN
          snap_best_d := snap_d;
          snap_best_j := j;
        END IF;
      END LOOP;

      stop_indices[s] := snap_best_j;
    END LOOP;
  END IF;

  IF editor THEN
    RETURN json_build_object(
      'start_edge_id', first_start_edge_id, 'start_fraction', first_start_fraction,
      'end_edge_id', last_end_edge_id, 'end_fraction', last_end_fraction,
      'route', combined_route, 'metadata', combined_metadata,
      'stop_indices', stop_indices, 'editor', combined_editor
    );
  ELSE
    RETURN json_build_object(
      'start_edge_id', first_start_edge_id, 'start_fraction', first_start_fraction,
      'end_edge_id', last_end_edge_id, 'end_fraction', last_end_fraction,
      'route', combined_route, 'metadata', combined_metadata, 'stop_indices', stop_indices
    );
  END IF;
END;
$$;
