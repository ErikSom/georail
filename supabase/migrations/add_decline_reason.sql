-- Add decline_reason field to rail_patches table
ALTER TABLE rail_patches ADD COLUMN IF NOT EXISTS decline_reason TEXT;

-- Add comment to describe the column
COMMENT ON COLUMN rail_patches.decline_reason IS 'Optional feedback provided by moderator when declining a patch';
