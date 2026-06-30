-- =====================================================================
-- Migration 0003 — cache identity fields on user_profiles
-- =====================================================================
-- libraryyy.com is the source of truth for email + name. Caching here
-- avoids a network call to libraryyy on every dashboard render. The
-- callback route refreshes these on every sign-in.
-- =====================================================================

ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS name  TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
