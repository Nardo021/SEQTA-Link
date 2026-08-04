-- CLI helpers: look up calendar owner without scanning all rows under RLS.
-- Used by rotate-token / inspect-feed under seqta_cli + withUserContext.

CREATE OR REPLACE FUNCTION lookup_calendar_owner(p_calendar_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT owner_user_id
  FROM calendars
  WHERE id = p_calendar_id;
$$;

ALTER FUNCTION lookup_calendar_owner(uuid) OWNER TO seqta_owner;

REVOKE ALL ON FUNCTION lookup_calendar_owner(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lookup_calendar_owner(uuid) TO seqta_cli, seqta_migrator;
