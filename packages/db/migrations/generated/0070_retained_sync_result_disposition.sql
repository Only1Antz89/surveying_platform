-- Replay identities survive retention; captured payloads do not.
CREATE FUNCTION guard_retained_sync_result() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE binding jsonb; protected boolean; bound_job uuid;
BEGIN
 IF TG_OP<>'INSERT' AND OLD.result->>'retentionRemoved'='true' THEN
  IF TG_OP='DELETE' OR to_jsonb(NEW)<>to_jsonb(OLD) THEN
   RAISE EXCEPTION 'Retained sync history cannot be restored, moved or deleted';
  END IF;
  RETURN NEW;
 END IF;
 FOR binding IN SELECT value FROM jsonb_array_elements(jsonb_build_array(CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END,CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END)) WHERE value<>'null'::jsonb LOOP
  SELECT s.job_id INTO bound_job FROM public.surveys s WHERE s.organisation_id=(binding->>'organisation_id')::uuid AND s.id=(binding->>'survey_id')::uuid;
  PERFORM 1 FROM public.jobs j WHERE j.organisation_id=(binding->>'organisation_id')::uuid AND j.id=bound_job FOR UPDATE;
  SELECT EXISTS(SELECT 1 FROM public.survey_field_values v WHERE binding->>'operation_type'='set_field' AND v.organisation_id=(binding->>'organisation_id')::uuid AND v.survey_id=(binding->>'survey_id')::uuid AND v.id::text=binding->'result'->>'id' AND v.value='{"retentionRemoved":true}'::jsonb)
   OR EXISTS(SELECT 1 FROM public.observations o WHERE binding->>'operation_type' IN('add_observation','revise_observation','withdraw_observation') AND o.organisation_id=(binding->>'organisation_id')::uuid AND o.survey_id=(binding->>'survey_id')::uuid AND o.id::text=binding->'result'->>'id' AND o.structured='{"retentionRemoved":true}'::jsonb) INTO protected;
  IF protected THEN
   IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Retained sync history cannot be deleted'; END IF;
   IF NEW.result<>jsonb_build_object('id',binding->'result'->>'id','retentionRemoved',true)
    OR (TG_OP='UPDATE' AND (to_jsonb(NEW)-'result')<>(to_jsonb(OLD)-'result')) THEN
    RAISE EXCEPTION 'Retained sync history cannot be restored or moved';
   END IF;
  END IF;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER retained_sync_result_guard BEFORE INSERT OR UPDATE OR DELETE ON sync_operations FOR EACH ROW EXECUTE FUNCTION guard_retained_sync_result();
--> statement-breakpoint
CREATE FUNCTION scrub_retained_sync_results() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF (TG_TABLE_NAME='survey_field_values' AND to_jsonb(NEW)->'value'='{"retentionRemoved":true}'::jsonb)
 OR (TG_TABLE_NAME='observations' AND to_jsonb(NEW)->'structured'='{"retentionRemoved":true}'::jsonb) THEN
  UPDATE public.sync_operations SET result=jsonb_build_object('id',NEW.id::text,'retentionRemoved',true)
   WHERE organisation_id=NEW.organisation_id AND survey_id=NEW.survey_id AND result->>'id'=NEW.id::text
   AND ((TG_TABLE_NAME='survey_field_values' AND operation_type='set_field') OR (TG_TABLE_NAME='observations' AND operation_type IN('add_observation','revise_observation','withdraw_observation')))
   AND result<>jsonb_build_object('id',NEW.id::text,'retentionRemoved',true);
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER scrub_recorded_value_sync_results AFTER UPDATE ON survey_field_values FOR EACH ROW EXECUTE FUNCTION scrub_retained_sync_results();
--> statement-breakpoint
CREATE TRIGGER scrub_observation_sync_results AFTER UPDATE ON observations FOR EACH ROW EXECUTE FUNCTION scrub_retained_sync_results();
--> statement-breakpoint
UPDATE sync_operations ledger SET result=jsonb_build_object('id',ledger.result->>'id','retentionRemoved',true)
 WHERE EXISTS(SELECT 1 FROM survey_field_values v WHERE ledger.operation_type='set_field' AND v.organisation_id=ledger.organisation_id AND v.survey_id=ledger.survey_id AND v.id::text=ledger.result->>'id' AND v.value='{"retentionRemoved":true}'::jsonb)
 OR EXISTS(SELECT 1 FROM observations o WHERE ledger.operation_type IN('add_observation','revise_observation','withdraw_observation') AND o.organisation_id=ledger.organisation_id AND o.survey_id=ledger.survey_id AND o.id::text=ledger.result->>'id' AND o.structured='{"retentionRemoved":true}'::jsonb);
