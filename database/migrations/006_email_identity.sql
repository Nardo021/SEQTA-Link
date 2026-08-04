-- Retire fake OIDC identity columns; email (+ password_hash) is the account key.

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_oidc_issuer_oidc_subject_key;

ALTER TABLE users
  DROP COLUMN IF EXISTS oidc_issuer,
  DROP COLUMN IF EXISTS oidc_subject;

-- Portal/password accounts must have unique email; CLI bootstrap users may omit email.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_lower
  ON users (lower(email))
  WHERE email IS NOT NULL;
