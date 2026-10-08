-- Customer statements (questionnaire drafts and submitted versions) are part of
-- the survey file. Once its originals reach storage dispatch they are fenced like
-- other file content, and the only permitted change is an audited, manager-approved
-- replacement of the answers with a removal marker after completed whole-file removal.
CREATE FUNCTION authorised_questionnaire_answer_disposition(previous jsonb, replacement jsonb, practice uuid, job uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT replacement->'answers'='{"retentionRemoved":true}'::jsonb
 AND (replacement-'answers')=(previous-'answers')
 AND previous->>'organisation_id'=practice::text AND previous->>'job_id'=job::text
 AND NOT EXISTS(SELECT 1 FROM public.job_retention_holds h WHERE h.organisation_id=practice AND h.job_id=job AND h.kind IS NOT NULL)
 AND NOT EXISTS(SELECT 1 FROM public.organisation_documents d WHERE d.organisation_id=practice AND d.legal_hold AND (
 d.job_id=job OR d.report_version_id IN(SELECT v.id FROM public.report_versions v WHERE v.organisation_id=practice AND v.job_id=job)
 OR d.id IN(SELECT delivery.document_id FROM public.report_deliveries delivery WHERE delivery.organisation_id=practice AND delivery.job_id=job)
 OR EXISTS(SELECT 1 FROM public.survey_file_removals r,jsonb_array_elements(r.manifest->'objects') obj WHERE r.organisation_id=practice AND r.job_id=job AND obj->>'kind'='document' AND obj->>'id'=d.id::text)))
 AND EXISTS(SELECT 1 FROM public.survey_file_removals r JOIN public.audit_events e ON e.organisation_id=r.organisation_id AND e.resource_type='job' AND e.resource_id=job::text AND e.action='job.questionnaire_answers_disposed' AND e.metadata->>'removalId'=r.id::text
 JOIN public.organisation_memberships m ON m.organisation_id=practice AND m.user_id=e.actor_user_id AND m.active AND m.role IN('owner','administrator','manager')
 WHERE r.organisation_id=practice AND r.job_id=job AND r.status='completed' AND e.metadata->>'confirmed'='true');
$$;
--> statement-breakpoint
CREATE FUNCTION guard_questionnaire_answers_under_original_removal() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE binding jsonb;
BEGIN
 FOR binding IN SELECT value FROM jsonb_array_elements(jsonb_build_array(CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END,CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END)) WHERE value<>'null'::jsonb LOOP
  PERFORM 1 FROM public.jobs j WHERE j.organisation_id=(binding->>'organisation_id')::uuid AND j.id=(binding->>'job_id')::uuid FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.survey_file_removals r WHERE r.organisation_id=(binding->>'organisation_id')::uuid AND r.job_id=(binding->>'job_id')::uuid AND r.status IN ('dispatched','verification_required','completed'))
  THEN
   IF TG_OP='UPDATE' AND public.authorised_questionnaire_answer_disposition(to_jsonb(OLD),to_jsonb(NEW),OLD.organisation_id,OLD.job_id) THEN CONTINUE; END IF;
   RAISE EXCEPTION 'Customer statements in a survey file under removal cannot be added, changed or deleted';
  END IF;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER questionnaire_draft_removal_fence BEFORE INSERT OR UPDATE OR DELETE ON preinspection_drafts FOR EACH ROW EXECUTE FUNCTION guard_questionnaire_answers_under_original_removal();
--> statement-breakpoint
CREATE TRIGGER questionnaire_submission_removal_fence BEFORE INSERT OR UPDATE OR DELETE ON preinspection_submissions FOR EACH ROW EXECUTE FUNCTION guard_questionnaire_answers_under_original_removal();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_preinspection_submission_changes() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND public.authorised_questionnaire_answer_disposition(to_jsonb(OLD),to_jsonb(NEW),OLD.organisation_id,OLD.job_id) THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'Submitted customer statements are immutable; create a correction version';
END $$;
