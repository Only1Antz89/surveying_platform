CREATE FUNCTION authorised_proposal_retention_disposition(previous jsonb, replacement jsonb, practice uuid, job uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT replacement->'proposed_value'='{"retentionRemoved":true}'::jsonb
 AND replacement->'evidence_refs'='[]'::jsonb AND replacement->'limitations'='[]'::jsonb
 AND replacement->'review_note'='null'::jsonb
 AND (replacement-'proposed_value'-'evidence_refs'-'limitations'-'review_note')=(previous-'proposed_value'-'evidence_refs'-'limitations'-'review_note')
 AND EXISTS(SELECT 1 FROM public.surveys s WHERE s.organisation_id=practice AND s.id::text=previous->>'survey_id' AND s.job_id=job)
 AND NOT EXISTS(SELECT 1 FROM public.job_retention_holds h WHERE h.organisation_id=practice AND h.job_id=job AND h.kind IS NOT NULL)
 AND NOT EXISTS(SELECT 1 FROM public.organisation_documents d WHERE d.organisation_id=practice AND d.legal_hold AND (
 d.job_id=job OR d.report_version_id IN(SELECT v.id FROM public.report_versions v WHERE v.organisation_id=practice AND v.job_id=job)
 OR d.id IN(SELECT delivery.document_id FROM public.report_deliveries delivery WHERE delivery.organisation_id=practice AND delivery.job_id=job)
 OR EXISTS(SELECT 1 FROM public.survey_file_removals r,jsonb_array_elements(r.manifest->'objects') obj WHERE r.organisation_id=practice AND r.job_id=job AND obj->>'kind'='document' AND obj->>'id'=d.id::text)))
 AND EXISTS(SELECT 1 FROM public.survey_file_removals r JOIN public.audit_events e ON e.organisation_id=r.organisation_id AND e.resource_id=previous->>'id' AND e.action='job.field_proposal_disposed' AND e.metadata->>'removalId'=r.id::text
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
    IF TG_TABLE_NAME='assistant_tasks' AND TG_OP='UPDATE' AND public.authorised_task_retention_disposition(to_jsonb(OLD),to_jsonb(NEW),candidate.organisation_id,candidate.id) THEN CONTINUE; END IF;
    IF TG_TABLE_NAME='field_proposals' AND TG_OP='UPDATE' AND public.authorised_proposal_retention_disposition(to_jsonb(OLD),to_jsonb(NEW),candidate.organisation_id,candidate.id) THEN CONTINUE; END IF;
    RAISE EXCEPTION 'Survey evidence under original removal cannot be added, changed, moved or deleted'; END IF;
  END LOOP;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_extracted_reference_under_original_removal() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE binding jsonb; references_json jsonb; candidate record;
BEGIN
 FOR binding IN SELECT value FROM jsonb_array_elements(jsonb_build_array(CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END,CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END)) WHERE value<>'null'::jsonb LOOP
  references_json=jsonb_build_array(binding->'evidence',binding->'evidence_refs',binding->'proposed_value',binding->'trace');
  FOR candidate IN SELECT r.organisation_id,r.job_id FROM public.survey_file_removals r WHERE r.organisation_id=(binding->>'organisation_id')::uuid AND EXISTS (
   SELECT 1 FROM (
    SELECT obj->>'id' AS identity FROM jsonb_array_elements(r.manifest->'objects') obj
    UNION SELECT m.client_generated_id FROM jsonb_array_elements(r.manifest->'objects') obj JOIN public.media_assets m ON m.organisation_id=r.organisation_id AND m.id::text=obj->>'id' WHERE obj->>'kind'='media'
    UNION SELECT a.id::text FROM jsonb_array_elements(r.manifest->'objects') obj JOIN public.media_analyses a ON a.organisation_id=r.organisation_id AND a.media_id::text=obj->>'id' WHERE obj->>'kind'='media'
   ) identities WHERE jsonb_path_query_array(references_json,'$.**.mediaId') ? identity OR jsonb_path_query_array(references_json,'$.**.analysisId') ? identity OR jsonb_path_query_array(references_json,'$.**.id') ? identity OR (binding->'trace'->'media') ? identity
  ) ORDER BY r.organisation_id,r.job_id LOOP
   PERFORM 1 FROM public.jobs j WHERE j.organisation_id=candidate.organisation_id AND j.id=candidate.job_id FOR UPDATE;
   IF EXISTS (SELECT 1 FROM public.survey_file_removals r WHERE r.organisation_id=candidate.organisation_id AND r.job_id=candidate.job_id AND r.status IN ('dispatched','verification_required','completed'))
   THEN
    IF TG_TABLE_NAME='assistant_tasks' AND TG_OP='UPDATE' AND public.authorised_task_retention_disposition(to_jsonb(OLD),to_jsonb(NEW),candidate.organisation_id,candidate.job_id) THEN CONTINUE; END IF;
    IF TG_TABLE_NAME='field_proposals' AND TG_OP='UPDATE' AND public.authorised_proposal_retention_disposition(to_jsonb(OLD),to_jsonb(NEW),candidate.organisation_id,candidate.job_id) THEN CONTINUE; END IF;
    RAISE EXCEPTION 'Extracted references to originals under removal cannot be added or changed'; END IF;
  END LOOP;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_field_proposals() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM public.surveys s WHERE s.organisation_id=OLD.organisation_id AND s.id=OLD.survey_id AND public.authorised_proposal_retention_disposition(to_jsonb(OLD),to_jsonb(NEW),s.organisation_id,s.job_id)) THEN RETURN NEW; END IF;
  IF TG_OP = 'DELETE' THEN
    IF current_setting('app.erasure', true) = 'on' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'field proposals are retained for audit and evaluation';
  END IF;
  IF OLD.review_status <> 'pending' THEN
    RAISE EXCEPTION 'a reviewed proposal cannot be changed';
  END IF;
  IF (to_jsonb(NEW) - 'review_status' - 'reviewed_at' - 'reviewed_by_user_id' - 'review_note' - 'accepted_value_id')
     <> (to_jsonb(OLD) - 'review_status' - 'reviewed_at' - 'reviewed_by_user_id' - 'review_note' - 'accepted_value_id') THEN
    RAISE EXCEPTION 'proposal content and provenance are immutable';
  END IF;
  RETURN NEW;
END;
$$;
