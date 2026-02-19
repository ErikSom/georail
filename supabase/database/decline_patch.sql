CREATE OR REPLACE FUNCTION decline_patch(
  declined_patch_id bigint
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_reviewer_id uuid;
BEGIN
  IF get_my_role() <> 'moderator' THEN
    RAISE EXCEPTION 'Permission denied: must be a moderator.';
  END IF;

  v_reviewer_id := auth.uid();

  UPDATE public.rail_patches
  SET status = 'declined',
      reviewed_at = now(),
      reviewed_by = v_reviewer_id
  WHERE id = declined_patch_id;

  RETURN json_build_object('success', true, 'patch_id', declined_patch_id, 'action', 'declined');
END;
$$;
