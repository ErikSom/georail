-- Track plays per route: a total counter + a per-month jsonb (keys "YYYY-MM").

ALTER TABLE user_routes
  ADD COLUMN IF NOT EXISTS total_plays int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS monthly_plays jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Atomic bump so concurrent plays don't lose counts.
CREATE OR REPLACE FUNCTION increment_user_route_plays(route_id uuid)
RETURNS void
LANGUAGE sql
SET search_path = public, extensions
AS $$
  UPDATE user_routes
  SET
    total_plays = total_plays + 1,
    monthly_plays = jsonb_set(
      monthly_plays,
      ARRAY[to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM')],
      to_jsonb(
        COALESCE(
          (monthly_plays ->> to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM'))::int,
          0
        ) + 1
      )
    )
  WHERE id = route_id;
$$;
