CREATE OR REPLACE FUNCTION save_rail_point_overrides_batch(
  p_segment_ids bigint[],              -- An array of all segment IDs
  p_indices integer[],                  -- An array of all point indices
  p_world_offset_x double precision[],  -- Array of X offsets
  p_world_offset_y double precision[],  -- Array of Y offsets (height)
  p_world_offset_z double precision[],  -- Array of Z offsets
  p_keynodes boolean[]                  -- Array of keynodes
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  INSERT INTO public.rail_point_overrides (
    segment_id, point_index, world_offset, keynode
  )
  SELECT
    segment_id,
    point_index,
    ARRAY[offset_x, offset_y, offset_z]::double precision[],
    keynode
  FROM
    -- UNNEST "zips" the parallel arrays into a set of rows
    UNNEST(p_segment_ids, p_indices, p_world_offset_x, p_world_offset_y, p_world_offset_z, p_keynodes)
    AS t(segment_id, point_index, offset_x, offset_y, offset_z, keynode)
  ON CONFLICT (segment_id, point_index) -- If a row already exists
  DO UPDATE SET
    world_offset = EXCLUDED.world_offset,
    keynode = EXCLUDED.keynode;
$$;
