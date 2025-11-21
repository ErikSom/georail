CREATE OR REPLACE FUNCTION approve_patch(
  approved_patch_id bigint
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER -- Runs as admin
AS $$
DECLARE
  v_editor_id uuid;
  v_reviewer_id uuid;
BEGIN
  -- Add this permission check
  IF get_my_role() <> 'moderator' THEN
    RAISE EXCEPTION 'Permission denied: must be a moderator.';
  END IF;

  v_reviewer_id := auth.uid();

  SELECT user_id INTO v_editor_id
  FROM public.rail_patches
  WHERE id = approved_patch_id;

  INSERT INTO public.rail_point_overrides (
    segment_id, point_index, world_offset, editor_id, reviewer_id, keynode
  )
  SELECT
    segment_id,
    point_index,
    world_offset,
    v_editor_id,   -- The patch creator
    v_reviewer_id,  -- The moderator approving
    keynode
  FROM public.rail_patch_data
  WHERE patch_id = approved_patch_id
  ON CONFLICT (segment_id, point_index)
  DO UPDATE SET
    world_offset = EXCLUDED.world_offset,
    editor_id = EXCLUDED.editor_id,
    reviewer_id = EXCLUDED.reviewer_id,
    keynode = EXCLUDED.keynode;

  UPDATE public.rail_patches
  SET status = 'approved',
      reviewed_at = now(),
      reviewed_by = v_reviewer_id
  WHERE id = approved_patch_id;

  RETURN json_build_object('success', true, 'patch_id', approved_patch_id, 'action', 'approved');
END;
$$;
