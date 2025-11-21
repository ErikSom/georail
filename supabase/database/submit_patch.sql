CREATE OR REPLACE FUNCTION submit_patch(
  patch_data jsonb,
  patch_id_to_update bigint DEFAULT NULL,
  p_from_station text DEFAULT NULL,
  p_from_track text DEFAULT NULL,
  p_to_station text DEFAULT NULL,
  p_to_track text DEFAULT NULL,
  p_description text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY INVOKER -- Runs as the user
AS $$
DECLARE
  new_patch_id bigint;
BEGIN
  -- Check if we are updating an existing patch
  IF patch_id_to_update IS NOT NULL THEN
    -- RLS policies will ensure the user owns this patch and it's 'pending'
    UPDATE public.rail_patches
    SET
      created_at = now(), -- Bump the timestamp
      from_station = COALESCE(p_from_station, from_station),
      from_track = COALESCE(p_from_track, from_track),
      to_station = COALESCE(p_to_station, to_station),
      to_track = COALESCE(p_to_track, to_track),
      description = COALESCE(p_description, description)
    WHERE id = patch_id_to_update
    RETURNING id INTO new_patch_id;

    IF new_patch_id IS NULL THEN
      RAISE EXCEPTION 'Patch not found or permission denied.';
    END IF;

    -- Clear out old data before inserting new data
    DELETE FROM public.rail_patch_data WHERE patch_id = new_patch_id;

  ELSE
    -- Create a new patch with route information
    INSERT INTO public.rail_patches (
      user_id,
      from_station,
      from_track,
      to_station,
      to_track,
      description
    )
    VALUES (
      auth.uid(),
      p_from_station,
      p_from_track,
      p_to_station,
      p_to_track,
      p_description
    )
    RETURNING id INTO new_patch_id;
  END IF;

  -- Insert all the new patch data from the JSON
  INSERT INTO public.rail_patch_data (
    patch_id, segment_id, point_index, world_offset, keynode
  )
  SELECT
    new_patch_id,
    (d.value ->> 'segment_id')::bigint,
    (d.value ->> 'index')::integer,
    ARRAY[
      (d.value ->> 'world_offset_x')::double precision,
      (d.value ->> 'world_offset_y')::double precision,
      (d.value ->> 'world_offset_z')::double precision
    ]::double precision[],
    COALESCE((d.value ->> 'keynode')::boolean, false)
  FROM jsonb_array_elements(patch_data) AS d;

  RETURN json_build_object('success', true, 'patch_id', new_patch_id);
END;
$$;
