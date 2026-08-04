-- Local email/password auth (no OIDC/Authentik)

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Normalized unique email for local accounts (NULLs allowed for legacy bootstrap rows)
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_lower
  ON users (lower(email))
  WHERE email IS NOT NULL;
