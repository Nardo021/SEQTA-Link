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
LANGUAGE sql STABLE AS $$
  SELECT
    d.id, d.owner_user_id, d.calendar_id, d.name, d.token_prefix, d.status,
    d.created_at, d.last_seen_at, d.last_synced_at,
    c.name, c.timezone, c.revision,
    si.school_host, si.student_ref,
    c.last_synced_at, c.last_changed_at, c.created_at, c.updated_at,
    u.account_status, u.sync_enabled, u.feed_enabled
  FROM devices d
  JOIN calendars c ON c.id = d.calendar_id
  JOIN users u ON u.id = d.owner_user_id
  LEFT JOIN source_identities si ON si.calendar_id = c.id
  WHERE d.token_hash = p_token_hash AND d.status = 'active';
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
LANGUAGE sql STABLE AS $$
  SELECT
    c.owner_user_id, c.id, c.name, c.timezone, c.revision,
    si.school_host, si.student_ref,
    c.last_synced_at, c.last_changed_at, c.created_at, c.updated_at,
    u.account_status, u.sync_enabled, u.feed_enabled
  FROM calendar_tokens ct
  JOIN calendars c ON c.id = ct.calendar_id
  JOIN users u ON u.id = c.owner_user_id
  LEFT JOIN source_identities si ON si.calendar_id = c.id
  WHERE ct.token_hash = p_token_hash AND ct.status = 'active';
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
LANGUAGE sql STABLE AS $$
  SELECT
    pc.id, pc.owner_user_id, pc.calendar_id, pc.expires_at, pc.used_at,
    u.account_status, u.sync_enabled, u.max_devices, c.name
  FROM pairing_codes pc
  JOIN users u ON u.id = pc.owner_user_id
  JOIN calendars c ON c.id = pc.calendar_id
  WHERE pc.code_hash = p_code_hash;
$$;
