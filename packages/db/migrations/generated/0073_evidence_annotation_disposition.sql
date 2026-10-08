CREATE FUNCTION authorised_evidence_annotation_disposition(previous jsonb, replacement jsonb, practice uuid, job uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT replacement->'note'='null'::jsonb AND replacement->'region'='{"retentionRemoved":true}'::jsonb
 AND (replacement-'note'-'region')=(previous-'note'-'region')
 AND EXISTS(SELECT 1 FROM public.surveys s WHERE s.organisation_id=practice AND s.id::text=previous->>'survey_id' AND s.job_id=job)
 AND NOT EXISTS(SELECT 1 FROM public.job_retention_holds h WHERE h.organisation_id=practice AND h.job_id=job AND h.kind IS NOT NULL)
 AND NOT EXISTS(SELECT 1 FROM public.organisation_documents d WHERE d.organisation_id=practice AND d.legal_hold AND (
 d.job_id=job OR d.report_version_id IN(SELECT v.id FROM public.report_versions v WHERE v.organisation_id=practice AND v.job_id=job)
 OR d.id IN(SELECT delivery.document_id FROM public.report_deliveries delivery WHERE delivery.organisation_id=practice AND delivery.job_id=job)
 OR EXISTS(SELECT 1 FROM public.survey_file_removals r,jsonb_array_elements(r.manifest->'objects') obj WHERE r.organisation_id=practice AND r.job_id=job AND obj->>'kind'='document' AND obj->>'id'=d.id::text)))
 AND EXISTS(SELECT 1 FROM public.survey_file_removals r JOIN public.audit_events e ON e.organisation_id=r.organisation_id AND e.resource_id=previous->>'id' AND e.action='job.evidence_annotation_disposed' AND e.metadata->>'removalId'=r.id::text
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
    IF TG_TABLE_NAME='evidence_links' AND TG_OP='UPDATE' AND public.authorised_evidence_annotation_disposition(to_jsonb(OLD),to_jsonb(NEW),candidate.organisation_id,candidate.id) THEN CONTINUE; END IF;
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
CREATE OR REPLACE FUNCTION guard_external_evidence_under_original_removal() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE binding jsonb; candidate record;
BEGIN
 FOR binding IN SELECT value FROM jsonb_array_elements(jsonb_build_array(CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END,CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END)) WHERE value<>'null'::jsonb LOOP
  FOR candidate IN SELECT DISTINCT r.organisation_id,r.job_id FROM public.survey_file_removals r WHERE r.organisation_id=(binding->>'organisation_id')::uuid AND (
   (binding->>'evidence_type'='prior_survey' AND EXISTS (SELECT 1 FROM public.surveys s WHERE s.organisation_id=r.organisation_id AND s.job_id=r.job_id AND s.id::text=binding->>'evidence_id'))
   OR (binding->>'evidence_type'='media' AND EXISTS (SELECT 1 FROM jsonb_array_elements(r.manifest->'objects') obj JOIN public.media_assets m ON m.organisation_id=r.organisation_id AND m.id::text=obj->>'id' WHERE obj->>'kind'='media' AND binding->>'evidence_id' IN (m.id::text,m.client_generated_id)))
  ) ORDER BY r.organisation_id,r.job_id LOOP
   PERFORM 1 FROM public.jobs j WHERE j.organisation_id=candidate.organisation_id AND j.id=candidate.job_id FOR UPDATE;
   IF EXISTS (SELECT 1 FROM public.survey_file_removals r WHERE r.organisation_id=candidate.organisation_id AND r.job_id=candidate.job_id AND r.status IN ('dispatched','verification_required','completed'))
   THEN
    IF TG_OP='UPDATE' AND public.authorised_evidence_annotation_disposition(to_jsonb(OLD),to_jsonb(NEW),candidate.organisation_id,candidate.job_id) THEN CONTINUE; END IF;
    RAISE EXCEPTION 'Evidence referring to a file under removal cannot be added or changed'; END IF;
  END LOOP;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
