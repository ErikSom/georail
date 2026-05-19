-- Lock down SECURITY DEFINER functions flagged by the Supabase linter.
-- Service-role calls bypass GRANTs, so offline scripts and server code continue to work.

-- ── Bulk-insert helpers: only used by offline scripts via service-role key.
REVOKE EXECUTE ON FUNCTION public.insert_rail_lines_batch(jsonb, text)
  FROM anon, authenticated, public;

REVOKE EXECUTE ON FUNCTION public.insert_stations_batch(jsonb, text)
  FROM anon, authenticated, public;

REVOKE EXECUTE ON FUNCTION public.save_rail_point_overrides_batch(
  bigint[], integer[], double precision[], double precision[], double precision[], boolean[]
) FROM anon, authenticated, public;

-- ── get_route_for_review: was leaking pending-patch review data to anon.
--    Apply the same moderator gate that list_patches/approve_patch use.
CREATE OR REPLACE FUNCTION get_route_for_review(
  start_lon float,
  start_lat float,
  end_lon float,
  end_lat float,
  review_patch_id bigint
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  start_node bigint;
  end_node   bigint;
  out_json   json;
BEGIN
  IF get_my_role() <> 'moderator' THEN
    RAISE EXCEPTION 'Permission denied: must be a moderator.';
  END IF;

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
  d AS (SELECT * FROM pgr_dijkstra($pgr$SELECT id, source, target, ST_Length(geom::geography) AS cost FROM rail_lines$pgr$, start_node, end_node, false)),
  ordered_segments AS (
    SELECT di.path_seq, rl.id AS segment_id, rl.geom AS original_geom,
      CASE WHEN di.node = rl.source THEN false ELSE true END AS is_reversed,
      CASE WHEN di.node = rl.source THEN rl.geom ELSE ST_Reverse(rl.geom) END AS geom_dir
    FROM d AS di JOIN rail_lines AS rl ON rl.id = di.edge WHERE di.edge <> -1
  ),
  route_points_base AS (
    SELECT s.path_seq, s.segment_id, s.is_reversed, (dump).path[1] AS point_index_in_route, (dump).geom AS original_point_geom,
      CASE WHEN s.is_reversed THEN ST_NPoints(s.original_geom) - (dump).path[1] ELSE (dump).path[1] - 1 END AS original_point_index
    FROM ordered_segments s, LATERAL ST_DumpPoints(s.geom_dir) AS dump
  ),
  final_points_data AS (
    SELECT
      b.path_seq, b.point_index_in_route, b.original_point_index, b.segment_id, b.is_reversed,
      ST_MakePoint(ST_X(b.original_point_geom), ST_Y(b.original_point_geom)) AS point_geom_2d,
      COALESCE(ovr_curr.height, ST_Z(b.original_point_geom), 0.0) AS current_height,
      COALESCE(ovr_curr.lateral_offset, 0.0) AS current_offset,
      COALESCE(ovr_patch.height, COALESCE(ovr_curr.height, ST_Z(b.original_point_geom), 0.0)) AS patch_height,
      COALESCE(ovr_patch.lateral_offset, COALESCE(ovr_curr.lateral_offset, 0.0)) AS patch_offset
    FROM route_points_base b
    LEFT JOIN public.rail_point_overrides ovr_curr
      ON ovr_curr.segment_id = b.segment_id AND ovr_curr.point_index = b.original_point_index
    LEFT JOIN public.rail_patch_data ovr_patch
      ON ovr_patch.segment_id = b.segment_id AND ovr_patch.point_index = b.original_point_index
      AND ovr_patch.patch_id = review_patch_id
  )
  SELECT json_build_object(
           'start_node', start_node,
           'end_node',   end_node,
           'review_patch_id', review_patch_id,
           'route_geojson', (
             SELECT ST_AsGeoJSON(ST_MakeLine(fp.point_geom_2d ORDER BY fp.path_seq, fp.point_index_in_route))::json
             FROM final_points_data AS fp
           ),
           'coordinate_data_for_review', (
             SELECT json_agg(
               json_build_object(
                 'segment_id', fp.segment_id,
                 'index', fp.original_point_index,
                 'is_reversed', fp.is_reversed,
                 'current_height', fp.current_height,
                 'current_offset', fp.current_offset,
                 'patch_height', fp.patch_height,
                 'patch_offset', fp.patch_offset
               )
               ORDER BY fp.path_seq, fp.point_index_in_route
             )
             FROM final_points_data AS fp
           )
         )
  INTO out_json;

  RETURN out_json;
END;
$$;

-- ── Pin search_path on the two flagged non-DEFINER functions.
--    Prevents search_path injection if a malicious schema is placed first.
ALTER FUNCTION public.increment_user_route_plays(uuid)
  SET search_path = public, extensions;

ALTER FUNCTION public.prevent_premium_field_modification()
  SET search_path = public, extensions;

-- ── handle_new_user: trigger fired by auth.users INSERT. Triggers ignore GRANTs,
--    so revoking REST-callable EXECUTE doesn't break signup.
REVOKE EXECUTE ON FUNCTION public.handle_new_user()
  FROM anon, authenticated, public;
