CREATE FUNCTION authorised_element_retention_disposition(previous jsonb, replacement jsonb, practice uuid, job uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT replacement->>'location_label'='retention-removed:'||(previous->>'id')
 AND replacement->>'limitation_reason'='Content removed after retention review'
 AND (replacement-'location_label'-'limitation_reason')=(previous-'location_label'-'limitation_reason')
 AND EXISTS(SELECT 1 FROM public.surveys s WHERE s.organisation_id=practice AND s.id::text=previous->>'survey_id' AND s.job_id=job)
 AND NOT EXISTS(SELECT 1 FROM public.job_retention_holds h WHERE h.organisation_id=practice AND h.job_id=job AND h.kind IS NOT NULL)
 AND NOT EXISTS(SELECT 1 FROM public.organisation_documents d WHERE d.organisation_id=practice AND d.legal_hold AND (
 d.job_id=job OR d.report_version_id IN(SELECT v.id FROM public.report_versions v WHERE v.organisation_id=practice AND v.job_id=job)
 OR d.id IN(SELECT delivery.document_id FROM public.report_deliveries delivery WHERE delivery.organisation_id=practice AND delivery.job_id=job)
 OR EXISTS(SELECT 1 FROM public.survey_file_removals r,jsonb_array_elements(r.manifest->'objects') obj WHERE r.organisation_id=practice AND r.job_id=job AND obj->>'kind'='document' AND obj->>'id'=d.id::text)))
 AND EXISTS(SELECT 1 FROM public.survey_file_removals r JOIN public.audit_events e ON e.organisation_id=r.organisation_id AND e.resource_id=previous->>'id' AND e.action='job.element_content_disposed' AND e.metadata->>'removalId'=r.id::text
 JOIN public.organisation_memberships m ON m.organisation_id=practice AND m.user_id=e.actor_user_id AND m.active AND m.role IN('owner','administrator','manager')
 WHERE r.organisation_id=practice AND r.job_id=job AND r.status='completed' AND e.metadata->>'confirmed'='true');
$$;


--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_survey_bound_record_under_original_removal() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE binding jsonb; candidate record;
BEGIN
 FOR binding IN SELECT value FROM jsonb_array_elements(jsonb_build_array(CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END,CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END)) WHERE value<>'null'::jsonb LOOP
  FOR candidate IN SELECT j.organisation_id,j.id FROM public.jobs j JOIN public.surveys s ON s.organisation_id=j.organisation_id AND s.job_id=j.id WHERE s.organisation_id=(binding->>'organisation_id')::uuid AND s.id=(binding->>'survey_id')::uuid LOOP
   PERFORM 1 FROM public.jobs j WHERE j.organisation_id=candidate.organisation_id AND j.id=candidate.id FOR UPDATE;
   IF EXISTS (SELECT 1 FROM public.survey_file_removals r WHERE r.organisation_id=candidate.organisation_id AND r.job_id=candidate.id AND r.status IN ('dispatched','verification_required','completed'))
   THEN
    IF TG_TABLE_NAME='survey_elements' AND TG_OP='UPDATE' AND public.authorised_element_retention_disposition(to_jsonb(OLD),to_jsonb(NEW),candidate.organisation_id,candidate.id) THEN CONTINUE; END IF;
    IF TG_TABLE_NAME='assistant_tasks' AND TG_OP='UPDATE' AND public.authorised_task_retention_disposition(to_jsonb(OLD),to_jsonb(NEW),candidate.organisation_id,candidate.id) THEN CONTINUE; END IF;
    IF TG_TABLE_NAME='field_proposals' AND TG_OP='UPDATE' AND public.authorised_proposal_retention_disposition(to_jsonb(OLD),to_jsonb(NEW),candidate.organisation_id,candidate.id) THEN CONTINUE; END IF;
    IF TG_TABLE_NAME='survey_field_values' AND TG_OP='UPDATE' AND public.authorised_recorded_value_retention_disposition(to_jsonb(OLD),to_jsonb(NEW),candidate.organisation_id,candidate.id) THEN CONTINUE; END IF;
    IF TG_TABLE_NAME='observations' AND TG_OP='UPDATE' AND public.authorised_observation_retention_disposition(to_jsonb(OLD),to_jsonb(NEW),candidate.organisation_id,candidate.id) THEN CONTINUE; END IF;
    RAISE EXCEPTION 'Survey evidence under original removal cannot be added, changed, moved or deleted'; END IF;
  END LOOP;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;


--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_retained_sync_result() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
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
   OR EXISTS(SELECT 1 FROM public.observations o WHERE binding->>'operation_type' IN('add_observation','revise_observation','withdraw_observation') AND o.organisation_id=(binding->>'organisation_id')::uuid AND o.survey_id=(binding->>'survey_id')::uuid AND o.id::text=binding->'result'->>'id' AND o.structured='{"retentionRemoved":true}'::jsonb) OR EXISTS(SELECT 1 FROM public.survey_elements e WHERE binding->>'operation_type'='set_element' AND e.organisation_id=(binding->>'organisation_id')::uuid AND e.survey_id=(binding->>'survey_id')::uuid AND e.id::text=binding->'result'->>'id' AND e.location_label='retention-removed:'||e.id::text AND e.limitation_reason='Content removed after retention review') INTO protected;
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
CREATE OR REPLACE FUNCTION scrub_retained_sync_results() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF (TG_TABLE_NAME='survey_field_values' AND to_jsonb(NEW)->'value'='{"retentionRemoved":true}'::jsonb)
 OR (TG_TABLE_NAME='observations' AND to_jsonb(NEW)->'structured'='{"retentionRemoved":true}'::jsonb) OR (TG_TABLE_NAME='survey_elements' AND to_jsonb(NEW)->>'location_label'='retention-removed:'||NEW.id::text AND to_jsonb(NEW)->>'limitation_reason'='Content removed after retention review') THEN
  UPDATE public.sync_operations SET result=jsonb_build_object('id',NEW.id::text,'retentionRemoved',true)
   WHERE organisation_id=NEW.organisation_id AND survey_id=NEW.survey_id AND result->>'id'=NEW.id::text
   AND ((TG_TABLE_NAME='survey_elements' AND operation_type='set_element') OR (TG_TABLE_NAME='survey_field_values' AND operation_type='set_field') OR (TG_TABLE_NAME='observations' AND operation_type IN('add_observation','revise_observation','withdraw_observation')))
   AND result<>jsonb_build_object('id',NEW.id::text,'retentionRemoved',true);
 END IF;
 RETURN NEW;
END $$;

--> statement-breakpoint
CREATE TRIGGER scrub_element_sync_results AFTER UPDATE ON survey_elements FOR EACH ROW EXECUTE FUNCTION scrub_retained_sync_results();
