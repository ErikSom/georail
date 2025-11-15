-- Enable RLS on rail_patches table
ALTER TABLE public.rail_patches ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view their own patches" ON public.rail_patches;
DROP POLICY IF EXISTS "Users can insert their own patches" ON public.rail_patches;
DROP POLICY IF EXISTS "Users can update their own pending patches" ON public.rail_patches;
DROP POLICY IF EXISTS "Users can delete their own pending patches" ON public.rail_patches;
DROP POLICY IF EXISTS "Admins can view all patches" ON public.rail_patches;
DROP POLICY IF EXISTS "Admins can update any patch" ON public.rail_patches;

-- Policy: Users can view their own patches
CREATE POLICY "Users can view their own patches"
ON public.rail_patches
FOR SELECT
USING (auth.uid() = user_id);

-- Policy: Users can insert their own patches
CREATE POLICY "Users can insert their own patches"
ON public.rail_patches
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own pending patches
CREATE POLICY "Users can update their own pending patches"
ON public.rail_patches
FOR UPDATE
USING (auth.uid() = user_id AND status = 'pending')
WITH CHECK (auth.uid() = user_id AND status = 'pending');

-- Policy: Users can delete their own pending patches
CREATE POLICY "Users can delete their own pending patches"
ON public.rail_patches
FOR DELETE
USING (auth.uid() = user_id AND status = 'pending');

-- Enable RLS on rail_patch_data table
ALTER TABLE public.rail_patch_data ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view data for their patches" ON public.rail_patch_data;
DROP POLICY IF EXISTS "Users can insert data for their patches" ON public.rail_patch_data;
DROP POLICY IF EXISTS "Users can update data for their pending patches" ON public.rail_patch_data;
DROP POLICY IF EXISTS "Users can delete data for their pending patches" ON public.rail_patch_data;

-- Policy: Users can view data for their patches
CREATE POLICY "Users can view data for their patches"
ON public.rail_patch_data
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.rail_patches rp
    WHERE rp.id = rail_patch_data.patch_id
    AND rp.user_id = auth.uid()
  )
);

-- Policy: Users can insert data for their patches
CREATE POLICY "Users can insert data for their patches"
ON public.rail_patch_data
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.rail_patches rp
    WHERE rp.id = rail_patch_data.patch_id
    AND rp.user_id = auth.uid()
  )
);

-- Policy: Users can update data for their pending patches
CREATE POLICY "Users can update data for their pending patches"
ON public.rail_patch_data
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.rail_patches rp
    WHERE rp.id = rail_patch_data.patch_id
    AND rp.user_id = auth.uid()
    AND rp.status = 'pending'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.rail_patches rp
    WHERE rp.id = rail_patch_data.patch_id
    AND rp.user_id = auth.uid()
    AND rp.status = 'pending'
  )
);

-- Policy: Users can delete data for their pending patches
CREATE POLICY "Users can delete data for their pending patches"
ON public.rail_patch_data
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.rail_patches rp
    WHERE rp.id = rail_patch_data.patch_id
    AND rp.user_id = auth.uid()
    AND rp.status = 'pending'
  )
);
