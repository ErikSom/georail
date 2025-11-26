-- Create function to get current user's role from profiles table
CREATE OR REPLACE FUNCTION get_my_role()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  user_role text;
BEGIN
  SELECT role INTO user_role
  FROM public.profiles
  WHERE id = auth.uid();

  RETURN COALESCE(user_role, 'user');
END;
$$;

-- Update RLS policy for rail_patches table to allow moderators to view all patches
DROP POLICY IF EXISTS "Moderators can view all patches" ON public.rail_patches;

CREATE POLICY "Moderators can view all patches"
ON public.rail_patches
FOR SELECT
USING (get_my_role() = 'moderator');

-- Allow users to reopen their own declined patches
DROP POLICY IF EXISTS "Users can reopen their own declined patches" ON public.rail_patches;

CREATE POLICY "Users can reopen their own declined patches"
ON public.rail_patches
FOR UPDATE
USING (auth.uid() = user_id AND status = 'declined')
WITH CHECK (auth.uid() = user_id AND status = 'editing');

-- Update existing policy for pending patches (editors can only change status to 'editing')
DROP POLICY IF EXISTS "Users can update their own pending patches" ON public.rail_patches;

CREATE POLICY "Users can update their own pending patches"
ON public.rail_patches
FOR UPDATE
USING (auth.uid() = user_id AND status = 'pending')
WITH CHECK (auth.uid() = user_id AND status = 'editing');

-- Allow users to update their own editing patches
DROP POLICY IF EXISTS "Users can update their own editing patches" ON public.rail_patches;

CREATE POLICY "Users can update their own editing patches"
ON public.rail_patches
FOR UPDATE
USING (auth.uid() = user_id AND status = 'editing')
WITH CHECK (auth.uid() = user_id);

-- Create trigger function to prevent editors from modifying review fields
CREATE OR REPLACE FUNCTION prevent_review_field_modification()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only apply this check if the user is not a moderator
  IF get_my_role() != 'moderator' THEN
    -- If any review field is being changed, prevent it
    IF (OLD.reviewed_at IS DISTINCT FROM NEW.reviewed_at) OR
       (OLD.reviewed_by IS DISTINCT FROM NEW.reviewed_by) OR
       (OLD.decline_reason IS DISTINCT FROM NEW.decline_reason) THEN
      RAISE EXCEPTION 'Editors cannot modify review fields (reviewed_at, reviewed_by, decline_reason)';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Create trigger on rail_patches table
DROP TRIGGER IF EXISTS check_review_field_modification ON public.rail_patches;

CREATE TRIGGER check_review_field_modification
BEFORE UPDATE ON public.rail_patches
FOR EACH ROW
EXECUTE FUNCTION prevent_review_field_modification();

-- Update RLS policy for rail_patch_data to allow moderators to view all patch data
DROP POLICY IF EXISTS "Users can view data for their patches" ON public.rail_patch_data;

CREATE POLICY "Users can view data for their patches"
ON public.rail_patch_data
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM rail_patches
    WHERE rail_patches.id = rail_patch_data.patch_id
    AND (rail_patches.user_id = auth.uid() OR get_my_role() = 'moderator')
  )
);
