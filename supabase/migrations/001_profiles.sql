-- Migration: 001_profiles
-- Design Ref: §3.3 profiles table + auth.users trigger
-- Plan SC: FR-02 (Profile auto-create on signup) + FR-12 (Credit system foundation)

CREATE TYPE account_type_enum AS ENUM (
  'teacher',
  'student',
  'school',
  'school_staff',
  'general'
);

CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  account_type account_type_enum NOT NULL DEFAULT 'general',
  credits INT NOT NULL DEFAULT 20 CHECK (credits >= 0),
  credits_reset_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_profiles_reset ON profiles(credits_reset_at)
  WHERE credits_reset_at IS NOT NULL;

-- Auto-create profile on new auth.users row
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO profiles (id, email, credits, credits_reset_at)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(current_setting('app.initial_credits', true)::INT, 50),
    NOW() + INTERVAL '1 month'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
