CREATE POLICY audit_events_personal_read ON audit_events FOR SELECT USING (
 resource_type='user'
 AND resource_id=nullif(current_setting('app.current_user_id',true),'')
 AND action IN ('account.created','account.profile_synchronised','account.profile_event_ignored','account.settings_updated')
);
CREATE POLICY audit_events_personal_insert ON audit_events FOR INSERT WITH CHECK (
 organisation_id IS NULL
 AND resource_type='user'
 AND resource_id=nullif(current_setting('app.current_user_id',true),'')
 AND actor_user_id=nullif(current_setting('app.current_user_id',true),'')::uuid
 AND action='account.settings_updated'
 AND platform_staff_id IS NULL
 AND support_session_id IS NULL
);
