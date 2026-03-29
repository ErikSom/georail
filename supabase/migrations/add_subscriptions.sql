-- Add subscription and integration columns to profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_premium boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS premium_source text,
  ADD COLUMN IF NOT EXISTS premium_until timestamptz,
  ADD COLUMN IF NOT EXISTS stripe_customer_id text UNIQUE,
  ADD COLUMN IF NOT EXISTS patreon_user_id text UNIQUE,
  ADD COLUMN IF NOT EXISTS discord_user_id text UNIQUE;

-- Migrate existing beta_access users to is_premium
UPDATE profiles SET is_premium = true WHERE beta_access = true;

-- Audit log for subscription state changes
CREATE TABLE IF NOT EXISTS subscription_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  source text NOT NULL,
  event_type text NOT NULL,
  raw_event jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sub_events_user ON subscription_events(user_id);

ALTER TABLE subscription_events ENABLE ROW LEVEL SECURITY;

-- No client access to subscription_events (server uses service key)

-- Prevent client-side writes to premium/integration columns on profiles
CREATE OR REPLACE FUNCTION prevent_premium_field_modification()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF (OLD.is_premium IS DISTINCT FROM NEW.is_premium) OR
     (OLD.premium_source IS DISTINCT FROM NEW.premium_source) OR
     (OLD.premium_until IS DISTINCT FROM NEW.premium_until) OR
     (OLD.stripe_customer_id IS DISTINCT FROM NEW.stripe_customer_id) OR
     (OLD.patreon_user_id IS DISTINCT FROM NEW.patreon_user_id) OR
     (OLD.discord_user_id IS DISTINCT FROM NEW.discord_user_id) THEN
    RAISE EXCEPTION 'Premium and integration fields can only be modified by the server';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS check_premium_field_modification ON public.profiles;

CREATE TRIGGER check_premium_field_modification
BEFORE UPDATE ON public.profiles
FOR EACH ROW
WHEN (current_setting('role') != 'service_role')
EXECUTE FUNCTION prevent_premium_field_modification();
