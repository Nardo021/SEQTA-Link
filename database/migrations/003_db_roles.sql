-- Phase 1 hardening: DB roles, grants, SECURITY DEFINER token resolvers.
-- Drops business-path bypass_rls policies. Table owner seqta_owner has BYPASSRLS
-- so definer functions can resolve tokens safely under FORCE RLS.
--
-- Runtime connections should SET ROLE to one of the API roles below.
-- Bootstrap grants those roles to the migrating user (see ensureRoleGrants).

DO $$ BEGIN
  CREATE ROLE seqta_owner NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER ROLE seqta_owner BYPASSRLS;

DO $$ BEGIN
  CREATE ROLE seqta_migrator NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE ROLE seqta_device_api NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE ROLE seqta_feed_api NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE ROLE seqta_cli NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE ROLE seqta_backup NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE ROLE seqta_user_api NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE ROLE seqta_admin_api NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Admin may read/write across tenants after app-level dual authorization + audit.
ALTER ROLE seqta_admin_api BYPASSRLS;

GRANT seqta_migrator TO CURRENT_USER;
GRANT seqta_owner TO seqta_migrator;
GRANT seqta_owner TO CURRENT_USER;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'schema_migrations',
    'users',
    'calendars',
    'source_identities',
    'calendar_tokens',
    'devices',
    'events',
    'event_aliases',
    'sync_runs',
    'invitations',
    'pairing_codes',
    'sessions',
    'audit_logs'
  ]
  LOOP
    EXECUTE format('ALTER TABLE IF EXISTS %I OWNER TO seqta_owner', tbl);
  END LOOP;
END $$;

DROP POLICY IF EXISTS calendars_service_bypass ON calendars;
DROP POLICY IF EXISTS events_service_bypass ON events;
DROP POLICY IF EXISTS aliases_service_bypass ON event_aliases;
DROP POLICY IF EXISTS devices_service_bypass ON devices;
DROP POLICY IF EXISTS sync_runs_service_bypass ON sync_runs;
DROP POLICY IF EXISTS source_identities_service_bypass ON source_identities;
DROP POLICY IF EXISTS calendar_tokens_service_bypass ON calendar_tokens;

DROP POLICY IF EXISTS calendar_tokens_owner_policy ON calendar_tokens;
CREATE POLICY calendar_tokens_owner_policy ON calendar_tokens
FOR ALL
USING (
    calendar_id IN (
        SELECT id FROM calendars
        WHERE owner_user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )
)
WITH CHECK (
    calendar_id IN (
        SELECT id FROM calendars
        WHERE owner_user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )
);

ALTER TABLE pairing_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE pairing_codes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pairing_codes_owner_policy ON pairing_codes;
CREATE POLICY pairing_codes_owner_policy ON pairing_codes
FOR ALL
USING (owner_user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
WITH CHECK (owner_user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

GRANT USAGE, CREATE ON SCHEMA public TO seqta_migrator;
GRANT USAGE ON SCHEMA public TO
  seqta_device_api, seqta_feed_api, seqta_cli,
  seqta_backup, seqta_user_api, seqta_admin_api;

GRANT SELECT, INSERT ON schema_migrations TO seqta_migrator;
GRANT ALL ON ALL TABLES IN SCHEMA public TO seqta_migrator;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO seqta_migrator;

GRANT SELECT, INSERT, UPDATE ON users TO seqta_cli, seqta_user_api, seqta_admin_api, seqta_device_api;
GRANT SELECT ON users TO seqta_feed_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON sessions TO seqta_user_api, seqta_admin_api, seqta_cli;
GRANT SELECT, INSERT, UPDATE ON invitations TO seqta_user_api, seqta_admin_api, seqta_cli;

GRANT SELECT, INSERT, UPDATE ON calendars TO seqta_device_api;
GRANT SELECT, INSERT, UPDATE ON source_identities TO seqta_device_api;
GRANT SELECT, INSERT, UPDATE ON devices TO seqta_device_api;
GRANT SELECT, INSERT, UPDATE ON events TO seqta_device_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON event_aliases TO seqta_device_api;
GRANT SELECT, INSERT, UPDATE ON sync_runs TO seqta_device_api;
GRANT SELECT, INSERT, UPDATE ON pairing_codes TO seqta_device_api;

GRANT SELECT ON calendars TO seqta_feed_api;
GRANT SELECT ON events TO seqta_feed_api;
GRANT SELECT ON source_identities TO seqta_feed_api;

GRANT SELECT, INSERT, UPDATE ON calendars TO seqta_cli;
GRANT SELECT, INSERT, UPDATE ON source_identities TO seqta_cli;
GRANT SELECT, INSERT, UPDATE ON calendar_tokens TO seqta_cli;
GRANT SELECT, INSERT, UPDATE ON devices TO seqta_cli;
GRANT SELECT ON events TO seqta_cli;
GRANT SELECT ON sync_runs TO seqta_cli;
GRANT SELECT, INSERT, UPDATE ON pairing_codes TO seqta_cli;

GRANT SELECT, INSERT, UPDATE ON calendars TO seqta_user_api;
GRANT SELECT, INSERT, UPDATE ON source_identities TO seqta_user_api;
GRANT SELECT, INSERT, UPDATE ON calendar_tokens TO seqta_user_api;
GRANT SELECT, INSERT, UPDATE ON devices TO seqta_user_api;
GRANT SELECT ON events TO seqta_user_api;
GRANT SELECT ON event_aliases TO seqta_user_api;
GRANT SELECT ON sync_runs TO seqta_user_api;
GRANT SELECT, INSERT, UPDATE ON pairing_codes TO seqta_user_api;
GRANT SELECT, INSERT ON audit_logs TO seqta_user_api;

GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO seqta_admin_api;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO seqta_backup;

CREATE OR REPLACE FUNCTION resolve_upload_token(p_token_hash text)
RETURNS TABLE (
  device_id uuid,
  owner_user_id uuid,
  calendar_id uuid,
  device_name text,
  device_token_prefix text,
  device_status text,
  device_created_at timestamptz,
  device_last_seen_at timestamptz,
  device_last_synced_at timestamptz,
  calendar_name text,
  timezone text,
  revision bigint,
  school_host text,
  student_ref text,
  calendar_last_synced_at timestamptz,
  calendar_last_changed_at timestamptz,
  calendar_created_at timestamptz,
  calendar_updated_at timestamptz,
  account_status text,
  sync_enabled boolean,
  feed_enabled boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    d.id,
    d.owner_user_id,
    d.calendar_id,
    d.name,
    d.token_prefix,
    d.status,
    d.created_at,
    d.last_seen_at,
    d.last_synced_at,
    c.name,
    c.timezone,
    c.revision,
    si.school_host,
    si.student_ref,
    c.last_synced_at,
    c.last_changed_at,
    c.created_at,
    c.updated_at,
    u.account_status,
    u.sync_enabled,
    u.feed_enabled
  FROM devices d
  JOIN calendars c ON c.id = d.calendar_id
  JOIN users u ON u.id = d.owner_user_id
  LEFT JOIN source_identities si ON si.calendar_id = c.id
  WHERE d.token_hash = p_token_hash
    AND d.status = 'active';
$$;

CREATE OR REPLACE FUNCTION resolve_calendar_token(p_token_hash text)
RETURNS TABLE (
  owner_user_id uuid,
  calendar_id uuid,
  calendar_name text,
  timezone text,
  revision bigint,
  school_host text,
  student_ref text,
  calendar_last_synced_at timestamptz,
  calendar_last_changed_at timestamptz,
  calendar_created_at timestamptz,
  calendar_updated_at timestamptz,
  account_status text,
  sync_enabled boolean,
  feed_enabled boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.owner_user_id,
    c.id,
    c.name,
    c.timezone,
    c.revision,
    si.school_host,
    si.student_ref,
    c.last_synced_at,
    c.last_changed_at,
    c.created_at,
    c.updated_at,
    u.account_status,
    u.sync_enabled,
    u.feed_enabled
  FROM calendar_tokens ct
  JOIN calendars c ON c.id = ct.calendar_id
  JOIN users u ON u.id = c.owner_user_id
  LEFT JOIN source_identities si ON si.calendar_id = c.id
  WHERE ct.token_hash = p_token_hash
    AND ct.status = 'active';
$$;

CREATE OR REPLACE FUNCTION resolve_pairing_code(p_code_hash text)
RETURNS TABLE (
  pairing_id uuid,
  owner_user_id uuid,
  calendar_id uuid,
  expires_at timestamptz,
  used_at timestamptz,
  account_status text,
  sync_enabled boolean,
  max_devices integer,
  calendar_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    pc.id,
    pc.owner_user_id,
    pc.calendar_id,
    pc.expires_at,
    pc.used_at,
    u.account_status,
    u.sync_enabled,
    u.max_devices,
    c.name
  FROM pairing_codes pc
  JOIN users u ON u.id = pc.owner_user_id
  JOIN calendars c ON c.id = pc.calendar_id
  WHERE pc.code_hash = p_code_hash;
$$;

ALTER FUNCTION resolve_upload_token(text) OWNER TO seqta_owner;
ALTER FUNCTION resolve_calendar_token(text) OWNER TO seqta_owner;
ALTER FUNCTION resolve_pairing_code(text) OWNER TO seqta_owner;

REVOKE ALL ON FUNCTION resolve_upload_token(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION resolve_calendar_token(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION resolve_pairing_code(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION resolve_upload_token(text) TO seqta_device_api, seqta_cli;
GRANT EXECUTE ON FUNCTION resolve_calendar_token(text) TO seqta_feed_api, seqta_cli, seqta_user_api;
GRANT EXECUTE ON FUNCTION resolve_pairing_code(text) TO seqta_device_api, seqta_cli;
