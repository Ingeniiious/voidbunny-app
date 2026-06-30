-- =====================================================================
-- Voidbunny subdomain service — initial schema (Neon Auth / Better Auth)
-- =====================================================================
-- Target: Neon Postgres (>= 15) with Neon Auth (Better Auth, beta) enabled
--
-- Apply with:
--   psql "$DATABASE_URL" -f site/migrations/0001_subdomain_service.sql
--
-- Test on a Neon *branch* of prod before applying to main. (Neon's branch
-- feature gives you an isolated copy with its own auth env — exactly what
-- you want for migration drills.)
--
-- Safe to re-run: all CREATEs use IF NOT EXISTS. Drops nothing.
-- =====================================================================
-- Two schemas in play:
--   * neon_auth.*  — Managed by Neon. Contains users / sessions / accounts /
--                    verification_tokens. DO NOT MODIFY. Do not add foreign
--                    keys to this schema from public.* — Neon may rewrite
--                    its internal layout.
--   * public.*     — Ours. Created here.
--
-- Linking strategy:
--   user_profiles.id is a UUID equal in value to neon_auth.user.id.
--   We treat it as a logical FK without enforcing it at the DB level.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;    -- case-insensitive lookups

-- ---------------------------------------------------------------------
-- user_profiles — Voidbunny's per-user data, keyed on neon_auth.user.id
-- ---------------------------------------------------------------------
-- A row is INSERTed in a post-signup hook (see site/lib/auth/profile.ts).
-- If the row is missing on a request, the API treats the session as
-- unprofiled and creates one lazily.

CREATE TABLE IF NOT EXISTS user_profiles (
  id                   UUID PRIMARY KEY,                          -- = neon_auth.user.id
  github_id            TEXT UNIQUE,
  github_username      TEXT,
  github_account_age_days INT,
  github_connected_at  TIMESTAMPTZ,
  tier                 SMALLINT NOT NULL DEFAULT 0,               -- 0 unverified | 1 verified
  subdomain_quota      SMALLINT NOT NULL DEFAULT 1,               -- recomputed by recompute_user_quota(); cap 6
  status               TEXT NOT NULL DEFAULT 'active',            -- 'active' | 'pending_review' | 'banned'
  referral_code        TEXT UNIQUE NOT NULL DEFAULT substr(md5(random()::text), 1, 8),
  referred_by          UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  signup_ip            INET,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  banned_at            TIMESTAMPTZ,
  banned_reason        TEXT
);

CREATE INDEX IF NOT EXISTS user_profiles_status_idx        ON user_profiles(status);
CREATE INDEX IF NOT EXISTS user_profiles_referred_by_idx   ON user_profiles(referred_by) WHERE referred_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS user_profiles_github_username_idx ON user_profiles(github_username) WHERE github_username IS NOT NULL;
CREATE INDEX IF NOT EXISTS user_profiles_tier_idx          ON user_profiles(tier);

-- ---------------------------------------------------------------------
-- subdomains — one row per active *.box.voidbunny.xyz record
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS subdomains (
  fqdn               TEXT PRIMARY KEY,
  slug               TEXT UNIQUE NOT NULL,
  profile_id         UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  ip                 INET NOT NULL,
  cf_record_id       TEXT NOT NULL,
  manage_token_hash  TEXT NOT NULL,                 -- bcrypt
  status             TEXT NOT NULL DEFAULT 'active',-- 'active' | 'reaped' | 'banned'
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_heartbeat     TIMESTAMPTZ NOT NULL DEFAULT now(),
  reaped_at          TIMESTAMPTZ,
  banned_at          TIMESTAMPTZ,
  banned_reason      TEXT
);

CREATE INDEX IF NOT EXISTS subdomains_profile_idx   ON subdomains(profile_id);
CREATE INDEX IF NOT EXISTS subdomains_status_idx    ON subdomains(status);
CREATE INDEX IF NOT EXISTS subdomains_heartbeat_idx ON subdomains(last_heartbeat) WHERE status = 'active';

-- ---------------------------------------------------------------------
-- claim_codes — one-time codes issued by /dashboard/claim, consumed by installer
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS claim_codes (
  code_hash      TEXT PRIMARY KEY,                   -- sha256 of vbc_* code
  profile_id     UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ NOT NULL,
  consumed_at    TIMESTAMPTZ,
  verify_token   TEXT NOT NULL                       -- random; box echoes via /api/voidbunny/claim-verify
);

CREATE INDEX IF NOT EXISTS claim_codes_profile_idx ON claim_codes(profile_id);
CREATE INDEX IF NOT EXISTS claim_codes_expires_idx ON claim_codes(expires_at) WHERE consumed_at IS NULL;

-- ---------------------------------------------------------------------
-- referrals — one row per signup-via-referral. bonus_granted_at is the gate.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS referrals (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id       UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  referred_id       UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  signup_ip         INET,
  bonus_granted_at  TIMESTAMPTZ,                     -- null until referred reaches tier 1 + has 7d-healthy subdomain
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (referred_id)                               -- a profile can only be referred once
);

CREATE INDEX IF NOT EXISTS referrals_referrer_idx ON referrals(referrer_id);

-- ---------------------------------------------------------------------
-- audit_log — 90-day retention, every claim/heartbeat/release/ban
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL PRIMARY KEY,
  ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id    UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,         -- 'claim' | 'heartbeat' | 'release' | 'ban' | 'tier_upgrade' | 'referral_grant' | ...
  target      TEXT,                  -- fqdn, profile_id, etc.
  ip          INET,
  user_agent  TEXT,
  payload     JSONB
);

CREATE INDEX IF NOT EXISTS audit_log_actor_idx     ON audit_log(actor_id, ts DESC);
CREATE INDEX IF NOT EXISTS audit_log_target_idx    ON audit_log(target);
CREATE INDEX IF NOT EXISTS audit_log_action_ts_idx ON audit_log(action, ts DESC);
CREATE INDEX IF NOT EXISTS audit_log_ts_idx        ON audit_log(ts);

-- ---------------------------------------------------------------------
-- Helper: recompute a profile's quota.
-- quota = 1 if tier 0
--       = 2 + (count of granted referrals, capped at 4) if tier 1
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION recompute_user_quota(target_profile UUID)
RETURNS SMALLINT AS $$
DECLARE
  user_tier SMALLINT;
  bonus_count INT;
  new_quota SMALLINT;
BEGIN
  SELECT tier INTO user_tier FROM user_profiles WHERE id = target_profile;
  IF user_tier IS NULL THEN
    RETURN 0;
  END IF;

  IF user_tier = 0 THEN
    new_quota := 1;
  ELSE
    SELECT LEAST(COUNT(*), 4) INTO bonus_count
      FROM referrals
      WHERE referrer_id = target_profile AND bonus_granted_at IS NOT NULL;
    new_quota := (2 + bonus_count)::SMALLINT;
  END IF;

  UPDATE user_profiles SET subdomain_quota = new_quota WHERE id = target_profile;
  RETURN new_quota;
END;
$$ LANGUAGE plpgsql;
