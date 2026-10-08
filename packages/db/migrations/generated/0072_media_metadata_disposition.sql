CREATE FUNCTION authorised_media_metadata_disposition(previous jsonb, replacement jsonb, practice uuid, job uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT replacement->'capture_context'='{"retentionRemoved":true}'::jsonb
 AND replacement->'original_filename'='null'::jsonb
 AND (replacement-'capture_context'-'original_filename')=(previous-'capture_context'-'original_filename')
 AND EXISTS(SELECT 1 FROM public.survey_file_removals r,jsonb_array_elements(r.manifest->'objects') obj WHERE r.organisation_id=practice AND r.job_id=job AND r.status='completed' AND obj->>'kind'='media' AND obj->>'id'=previous->>'id' AND obj->>'storagePath'=previous->>'storage_key' AND obj->>'checksum'=previous->>'sha256' AND (obj->>'sizeBytes')::bigint=(previous->>'byte_size')::bigint AND r.progress->('media:'||(previous->>'id'))->>'state'='removed')
 AND NOT EXISTS(SELECT 1 FROM public.job_retention_holds h WHERE h.organisation_id=practice AND h.job_id=job AND h.kind IS NOT NULL)
 AND NOT EXISTS(SELECT 1 FROM public.organisation_documents d WHERE d.organisation_id=practice AND d.legal_hold AND (
 d.job_id=job OR d.report_version_id IN(SELECT v.id FROM public.report_versions v WHERE v.organisation_id=practice AND v.job_id=job)
 OR d.id IN(SELECT delivery.document_id FROM public.report_deliveries delivery WHERE delivery.organisation_id=practice AND delivery.job_id=job)
 OR EXISTS(SELECT 1 FROM public.survey_file_removals r,jsonb_array_elements(r.manifest->'objects') obj WHERE r.organisation_id=practice AND r.job_id=job AND obj->>'kind'='document' AND obj->>'id'=d.id::text)))
 AND EXISTS(SELECT 1 FROM public.survey_file_removals r JOIN public.audit_events e ON e.organisation_id=r.organisation_id AND e.resource_id=previous->>'id' AND e.action='job.media_metadata_disposed' AND e.metadata->>'removalId'=r.id::text
 JOIN public.organisation_memberships m ON m.organisation_id=practice AND m.user_id=e.actor_user_id AND m.active AND m.role IN('owner','administrator','manager')
 WHERE r.organisation_id=practice AND r.job_id=job AND r.status='completed' AND e.metadata->>'confirmed'='true');
$$;


--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_media_under_original_removal() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE binding jsonb; candidate record;
BEGIN
 FOR binding IN SELECT value FROM jsonb_array_elements(jsonb_build_array(CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END,CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END)) WHERE value<>'null'::jsonb LOOP
  FOR candidate IN
   SELECT DISTINCT j.organisation_id,j.id FROM public.jobs j WHERE j.organisation_id=(binding->>'organisation_id')::uuid AND (
    EXISTS (SELECT 1 FROM public.surveys s WHERE s.organisation_id=j.organisation_id AND s.job_id=j.id AND s.id=(binding->>'survey_id')::uuid)
    OR EXISTS (SELECT 1 FROM public.survey_file_removals r, jsonb_array_elements(r.manifest->'objects') obj WHERE r.organisation_id=j.organisation_id AND r.job_id=j.id AND obj->>'kind'='media' AND obj->>'id' IN (binding->>'id',binding->>'derived_from_id',binding->>'media_id'))
   ) ORDER BY j.organisation_id,j.id
  LOOP
   PERFORM 1 FROM public.jobs j WHERE j.organisation_id=candidate.organisation_id AND j.id=candidate.id FOR UPDATE;
   IF EXISTS (SELECT 1 FROM public.survey_file_removals r WHERE r.organisation_id=candidate.organisation_id AND r.job_id=candidate.id AND r.status IN ('dispatched','verification_required','completed'))
   THEN
    IF TG_TABLE_NAME='media_assets' AND TG_OP='UPDATE' AND public.authorised_media_metadata_disposition(to_jsonb(OLD),to_jsonb(NEW),candidate.organisation_id,candidate.id) THEN CONTINUE; END IF;
    IF TG_TABLE_NAME='media_analyses' AND TG_OP='UPDATE'
     AND to_jsonb(NEW)->'result'='{"retentionRemoved":true}'::jsonb
     AND (to_jsonb(NEW)-'result')=(to_jsonb(OLD)-'result')
    AND NOT EXISTS(SELECT 1 FROM public.job_retention_holds h WHERE h.organisation_id=candidate.organisation_id AND h.job_id=candidate.id AND h.kind IS NOT NULL)
    AND NOT EXISTS(SELECT 1 FROM public.organisation_documents d WHERE d.organisation_id=candidate.organisation_id AND d.legal_hold AND (d.job_id=candidate.id OR d.report_version_id IN (SELECT v.id FROM public.report_versions v WHERE v.organisation_id=candidate.organisation_id AND v.job_id=candidate.id)
      OR d.id IN (SELECT delivery.document_id FROM public.report_deliveries delivery WHERE delivery.organisation_id=candidate.organisation_id AND delivery.job_id=candidate.id)
      OR EXISTS(SELECT 1 FROM public.survey_file_removals held_removal, jsonb_array_elements(held_removal.manifest->'objects') held_object WHERE held_removal.organisation_id=candidate.organisation_id AND held_removal.job_id=candidate.id AND held_object->>'kind'='document' AND held_object->>'id'=d.id::text)))
     AND EXISTS(SELECT 1 FROM public.survey_file_removals r WHERE r.organisation_id=candidate.organisation_id AND r.job_id=candidate.id AND r.status='completed'
       AND r.progress->('media:'||(to_jsonb(OLD)->>'media_id'))->>'state'='removed'
       AND EXISTS(SELECT 1 FROM jsonb_array_elements(r.manifest->'objects') obj WHERE obj->>'kind'='media' AND obj->>'id'=to_jsonb(OLD)->>'media_id')
       AND EXISTS(SELECT 1 FROM public.audit_events e WHERE e.organisation_id=candidate.organisation_id AND e.resource_id=to_jsonb(OLD)->>'id' AND e.action='job.media_analysis_disposed' AND e.metadata->>'removalId'=r.id::text AND e.metadata->>'mediaId'=to_jsonb(OLD)->>'media_id'))
    THEN CONTINUE; END IF;
    RAISE EXCEPTION 'Media belonging to a file under removal cannot be changed or extended';
   END IF;
  END LOOP;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;


--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_media_originals() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM public.survey_file_removals r WHERE r.organisation_id=OLD.organisation_id AND public.authorised_media_metadata_disposition(to_jsonb(OLD),to_jsonb(NEW),OLD.organisation_id,r.job_id)) THEN RETURN NEW; END IF;
  IF TG_OP = 'DELETE' THEN
    IF current_setting('app.erasure', true) = 'on' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'media assets cannot be deleted outside the erasure routine';
  END IF;
  IF (to_jsonb(NEW) - 'status' - 'deleted_at') <> (to_jsonb(OLD) - 'status' - 'deleted_at') THEN
    RAISE EXCEPTION 'media assets are immutable; store an annotated or processed version as a new derived asset';
  END IF;
  RETURN NEW;
END;
$$;
