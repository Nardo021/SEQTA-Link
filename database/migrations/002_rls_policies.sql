-- Row-Level Security policies for v2 multi-user isolation

ALTER TABLE calendars ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendars FORCE ROW LEVEL SECURITY;

ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices FORCE ROW LEVEL SECURITY;

ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE events FORCE ROW LEVEL SECURITY;

ALTER TABLE event_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_aliases FORCE ROW LEVEL SECURITY;

ALTER TABLE sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_runs FORCE ROW LEVEL SECURITY;

ALTER TABLE source_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_identities FORCE ROW LEVEL SECURITY;

-- Owner-scoped access when app.current_user_id is set
CREATE POLICY calendars_owner_policy ON calendars
FOR ALL
USING (owner_user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
WITH CHECK (owner_user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

CREATE POLICY events_owner_policy ON events
FOR ALL
USING (owner_user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
WITH CHECK (owner_user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

CREATE POLICY aliases_owner_policy ON event_aliases
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

CREATE POLICY devices_owner_policy ON devices
FOR ALL
USING (owner_user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
WITH CHECK (owner_user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

CREATE POLICY sync_runs_owner_policy ON sync_runs
FOR ALL
USING (owner_user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
WITH CHECK (owner_user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

CREATE POLICY source_identities_owner_policy ON source_identities
FOR ALL
USING (
    calendar_id IN (
        SELECT id FROM calendars
        WHERE owner_user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )
);

-- Service role bypass for token-auth routes (calendar feed, device sync)
-- Application sets app.bypass_rls = 'true' on dedicated pool connections.
CREATE POLICY calendars_service_bypass ON calendars
FOR ALL
USING (current_setting('app.bypass_rls', true) = 'true')
WITH CHECK (current_setting('app.bypass_rls', true) = 'true');

CREATE POLICY events_service_bypass ON events
FOR ALL
USING (current_setting('app.bypass_rls', true) = 'true')
WITH CHECK (current_setting('app.bypass_rls', true) = 'true');

CREATE POLICY aliases_service_bypass ON event_aliases
FOR ALL
USING (current_setting('app.bypass_rls', true) = 'true')
WITH CHECK (current_setting('app.bypass_rls', true) = 'true');

CREATE POLICY devices_service_bypass ON devices
FOR ALL
USING (current_setting('app.bypass_rls', true) = 'true')
WITH CHECK (current_setting('app.bypass_rls', true) = 'true');

CREATE POLICY sync_runs_service_bypass ON sync_runs
FOR ALL
USING (current_setting('app.bypass_rls', true) = 'true')
WITH CHECK (current_setting('app.bypass_rls', true) = 'true');

CREATE POLICY source_identities_service_bypass ON source_identities
FOR ALL
USING (current_setting('app.bypass_rls', true) = 'true')
WITH CHECK (current_setting('app.bypass_rls', true) = 'true');

-- calendar_tokens: no RLS (looked up by hash only, no user context)
ALTER TABLE calendar_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_tokens FORCE ROW LEVEL SECURITY;

CREATE POLICY calendar_tokens_service_bypass ON calendar_tokens
FOR ALL
USING (current_setting('app.bypass_rls', true) = 'true')
WITH CHECK (current_setting('app.bypass_rls', true) = 'true');
