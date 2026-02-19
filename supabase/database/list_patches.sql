CREATE OR REPLACE FUNCTION list_patches(
  patch_status text DEFAULT 'pending'
)
RETURNS SETOF public.rail_patches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF get_my_role() <> 'moderator' THEN
    RAISE EXCEPTION 'Permission denied: must be a moderator.';
  END IF;

  RETURN QUERY
    SELECT *
    FROM public.rail_patches
    WHERE status = patch_status
    ORDER BY created_at ASC;
END;
$$;
