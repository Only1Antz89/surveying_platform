CREATE OR REPLACE FUNCTION guard_job_bound_record_under_original_removal() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE binding record;
BEGIN
 FOR binding IN
  SELECT DISTINCT organisation_id,job_id FROM (
   SELECT CASE WHEN TG_OP='INSERT' THEN NULL::uuid ELSE OLD.organisation_id END AS organisation_id,
          CASE WHEN TG_OP='INSERT' THEN NULL::uuid ELSE OLD.job_id END AS job_id
   UNION ALL
   SELECT CASE WHEN TG_OP='DELETE' THEN NULL::uuid ELSE NEW.organisation_id END,
          CASE WHEN TG_OP='DELETE' THEN NULL::uuid ELSE NEW.job_id END
  ) bindings WHERE job_id IS NOT NULL ORDER BY organisation_id,job_id
 LOOP
  PERFORM 1 FROM public.jobs j WHERE j.organisation_id=binding.organisation_id AND j.id=binding.job_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.survey_file_removals r WHERE r.organisation_id=binding.organisation_id AND r.job_id=binding.job_id AND r.status IN ('dispatched','verification_required','completed'))
  THEN
   IF TG_TABLE_NAME='preinspection_documents' AND TG_OP='UPDATE'
    AND to_jsonb(NEW)->'analysis'='{"retentionRemoved":true}'::jsonb
    AND (to_jsonb(NEW)-'analysis'-'updated_at')=(to_jsonb(OLD)-'analysis'-'updated_at')
    AND NOT EXISTS(SELECT 1 FROM public.job_retention_holds h WHERE h.organisation_id=binding.organisation_id AND h.job_id=binding.job_id AND h.kind IS NOT NULL)
    AND NOT EXISTS(SELECT 1 FROM public.organisation_documents d WHERE d.organisation_id=binding.organisation_id AND d.legal_hold AND (d.job_id=binding.job_id OR d.report_version_id IN (SELECT v.id FROM public.report_versions v WHERE v.organisation_id=binding.organisation_id AND v.job_id=binding.job_id)
      OR d.id IN (SELECT delivery.document_id FROM public.report_deliveries delivery WHERE delivery.organisation_id=binding.organisation_id AND delivery.job_id=binding.job_id)
      OR EXISTS(SELECT 1 FROM public.survey_file_removals held_removal, jsonb_array_elements(held_removal.manifest->'objects') held_object WHERE held_removal.organisation_id=binding.organisation_id AND held_removal.job_id=binding.job_id AND held_object->>'kind'='document' AND held_object->>'id'=d.id::text)))
    AND EXISTS(SELECT 1 FROM public.survey_file_removals r WHERE r.organisation_id=binding.organisation_id AND r.job_id=binding.job_id AND r.status='completed'
      AND r.progress->('questionnaire:'||(to_jsonb(OLD)->>'id'))->>'state'='removed'
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(r.manifest->'objects') obj WHERE obj->>'kind'='questionnaire' AND obj->>'id'=to_jsonb(OLD)->>'id')
      AND EXISTS(SELECT 1 FROM public.audit_events e WHERE e.organisation_id=binding.organisation_id AND e.resource_id=to_jsonb(OLD)->>'id' AND e.action='job.questionnaire_analysis_disposed' AND e.metadata->>'removalId'=r.id::text AND e.metadata->>'originalChecksum'=to_jsonb(OLD)->>'checksum'))
   THEN CONTINUE; END IF;
   RAISE EXCEPTION 'A record bound to a file under original removal cannot be added, changed, moved or deleted';
  END IF;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
