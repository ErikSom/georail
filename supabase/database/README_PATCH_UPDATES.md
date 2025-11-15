# Database Updates for Patch Route Information

## Overview
These updates add route information (stations, tracks, description) to the patch system.

## Required Changes

### 1. Add Columns to `rail_patches` Table

Run the migration in `add_patch_route_info`:

```sql
ALTER TABLE public.rail_patches
ADD COLUMN IF NOT EXISTS from_station text,
ADD COLUMN IF NOT EXISTS from_track text,
ADD COLUMN IF NOT EXISTS to_station text,
ADD COLUMN IF NOT EXISTS to_track text,
ADD COLUMN IF NOT EXISTS description text;
```

This adds:
- `from_station` - Starting station name (e.g., "Amsterdam Centraal")
- `from_track` - Starting track identifier (e.g., "4b")
- `to_station` - Destination station name (e.g., "Utrecht Centraal")
- `to_track` - Destination track identifier (e.g., "19")
- `description` - Optional user description of changes

### 2. Update `submit_patch` Function

Replace the existing `submit_patch` function with the updated version in `submit_patch_v2`:

The new function signature:
```sql
submit_patch(
  patch_data jsonb,
  patch_id_to_update bigint DEFAULT NULL,
  p_from_station text DEFAULT NULL,
  p_from_track text DEFAULT NULL,
  p_to_station text DEFAULT NULL,
  p_to_track text DEFAULT NULL,
  p_description text DEFAULT NULL
)
```

**Changes:**
- Adds 5 new optional parameters for route information
- When creating a new patch, stores route info in the `rail_patches` table
- When updating a patch, updates route info if provided (uses COALESCE to preserve existing values)
- Maintains backward compatibility with old calls (parameters are optional)

## Deployment Steps

1. **Backup your database** (recommended)
2. Run `add_patch_route_info` to add the new columns
3. Run `submit_patch_v2` to update the function
4. Verify the changes work with existing patches
5. Deploy the updated frontend code

## Testing

After deployment, you should be able to:
1. Create new patches with route information
2. View patch titles as "Station A (Track) → Station B (Track)"
3. Edit existing patches and update route info
4. See descriptions in the patch list

## Rollback

If needed, you can rollback by:
1. Reverting the `submit_patch` function to the original version
2. Optionally removing the new columns (though this will delete data):
   ```sql
   ALTER TABLE public.rail_patches
   DROP COLUMN IF EXISTS from_station,
   DROP COLUMN IF EXISTS from_track,
   DROP COLUMN IF EXISTS to_station,
   DROP COLUMN IF EXISTS to_track,
   DROP COLUMN IF EXISTS description;
   ```
