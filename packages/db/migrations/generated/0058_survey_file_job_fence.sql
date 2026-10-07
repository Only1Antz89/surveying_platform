CREATE FUNCTION guard_job_under_original_removal() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM public.survey_file_removals r WHERE r.organisation_id=OLD.organisation_id AND r.job_id=OLD.id AND r.status IN ('dispatched','verification_required','completed')) THEN
  IF TG_OP='DELETE' OR NEW IS DISTINCT FROM OLD THEN
   RAISE EXCEPTION 'A job under original removal cannot be reopened, changed or deleted';
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER job_original_removal_fence BEFORE UPDATE OR DELETE ON jobs FOR EACH ROW EXECUTE FUNCTION guard_job_under_original_removal();
--> statement-breakpoint
CREATE FUNCTION guard_job_bound_record_under_original_removal() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
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
  THEN RAISE EXCEPTION 'A record bound to a file under original removal cannot be added, changed, moved or deleted'; END IF;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER questionnaire_original_removal_fence BEFORE INSERT OR UPDATE OR DELETE ON preinspection_documents FOR EACH ROW EXECUTE FUNCTION guard_job_bound_record_under_original_removal();
CREATE TRIGGER survey_original_removal_fence BEFORE INSERT OR UPDATE OR DELETE ON surveys FOR EACH ROW EXECUTE FUNCTION guard_job_bound_record_under_original_removal();
--> statement-breakpoint
CREATE FUNCTION guard_media_under_original_removal() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
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
   THEN RAISE EXCEPTION 'Media belonging to a file under removal cannot be changed or extended'; END IF;
  END LOOP;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER media_original_removal_fence BEFORE INSERT OR UPDATE OR DELETE ON media_assets FOR EACH ROW EXECUTE FUNCTION guard_media_under_original_removal();
CREATE TRIGGER analysis_original_removal_fence BEFORE INSERT OR UPDATE OR DELETE ON media_analyses FOR EACH ROW EXECUTE FUNCTION guard_media_under_original_removal();
--> statement-breakpoint
CREATE FUNCTION guard_survey_bound_record_under_original_removal() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE binding jsonb; candidate record;
BEGIN
 FOR binding IN SELECT value FROM jsonb_array_elements(jsonb_build_array(CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END,CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END)) WHERE value<>'null'::jsonb LOOP
  FOR candidate IN SELECT j.organisation_id,j.id FROM public.jobs j JOIN public.surveys s ON s.organisation_id=j.organisation_id AND s.job_id=j.id WHERE s.organisation_id=(binding->>'organisation_id')::uuid AND s.id=(binding->>'survey_id')::uuid LOOP
   PERFORM 1 FROM public.jobs j WHERE j.organisation_id=candidate.organisation_id AND j.id=candidate.id FOR UPDATE;
   IF EXISTS (SELECT 1 FROM public.survey_file_removals r WHERE r.organisation_id=candidate.organisation_id AND r.job_id=candidate.id AND r.status IN ('dispatched','verification_required','completed'))
   THEN RAISE EXCEPTION 'Survey evidence under original removal cannot be added, changed, moved or deleted'; END IF;
  END LOOP;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER element_original_removal_fence BEFORE INSERT OR UPDATE OR DELETE ON survey_elements FOR EACH ROW EXECUTE FUNCTION guard_survey_bound_record_under_original_removal();
CREATE TRIGGER field_original_removal_fence BEFORE INSERT OR UPDATE OR DELETE ON survey_field_values FOR EACH ROW EXECUTE FUNCTION guard_survey_bound_record_under_original_removal();
CREATE TRIGGER observation_original_removal_fence BEFORE INSERT OR UPDATE OR DELETE ON observations FOR EACH ROW EXECUTE FUNCTION guard_survey_bound_record_under_original_removal();
CREATE TRIGGER evidence_original_removal_fence BEFORE INSERT OR UPDATE OR DELETE ON evidence_links FOR EACH ROW EXECUTE FUNCTION guard_survey_bound_record_under_original_removal();
CREATE TRIGGER task_original_removal_fence BEFORE INSERT OR UPDATE OR DELETE ON assistant_tasks FOR EACH ROW EXECUTE FUNCTION guard_survey_bound_record_under_original_removal();
CREATE TRIGGER proposal_original_removal_fence BEFORE INSERT OR UPDATE OR DELETE ON field_proposals FOR EACH ROW EXECUTE FUNCTION guard_survey_bound_record_under_original_removal();
CREATE TRIGGER report_original_removal_fence BEFORE INSERT OR UPDATE OR DELETE ON report_versions FOR EACH ROW EXECUTE FUNCTION guard_job_bound_record_under_original_removal();
CREATE TRIGGER delivery_original_removal_fence BEFORE INSERT OR UPDATE OR DELETE ON report_deliveries FOR EACH ROW EXECUTE FUNCTION guard_job_bound_record_under_original_removal();
--> statement-breakpoint
CREATE FUNCTION guard_external_evidence_under_original_removal() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE binding jsonb; candidate record;
BEGIN
 FOR binding IN SELECT value FROM jsonb_array_elements(jsonb_build_array(CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END,CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END)) WHERE value<>'null'::jsonb LOOP
  FOR candidate IN SELECT DISTINCT r.organisation_id,r.job_id FROM public.survey_file_removals r WHERE r.organisation_id=(binding->>'organisation_id')::uuid AND (
   (binding->>'evidence_type'='prior_survey' AND EXISTS (SELECT 1 FROM public.surveys s WHERE s.organisation_id=r.organisation_id AND s.job_id=r.job_id AND s.id::text=binding->>'evidence_id'))
   OR (binding->>'evidence_type'='media' AND EXISTS (SELECT 1 FROM jsonb_array_elements(r.manifest->'objects') obj JOIN public.media_assets m ON m.organisation_id=r.organisation_id AND m.id::text=obj->>'id' WHERE obj->>'kind'='media' AND binding->>'evidence_id' IN (m.id::text,m.client_generated_id)))
  ) ORDER BY r.organisation_id,r.job_id LOOP
   PERFORM 1 FROM public.jobs j WHERE j.organisation_id=candidate.organisation_id AND j.id=candidate.job_id FOR UPDATE;
   IF EXISTS (SELECT 1 FROM public.survey_file_removals r WHERE r.organisation_id=candidate.organisation_id AND r.job_id=candidate.job_id AND r.status IN ('dispatched','verification_required','completed'))
   THEN RAISE EXCEPTION 'Evidence referring to a file under removal cannot be added or changed'; END IF;
  END LOOP;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER external_evidence_original_removal_fence BEFORE INSERT OR UPDATE OR DELETE ON evidence_links FOR EACH ROW EXECUTE FUNCTION guard_external_evidence_under_original_removal();
--> statement-breakpoint
CREATE FUNCTION guard_extracted_reference_under_original_removal() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE binding jsonb; references_json jsonb; candidate record;
BEGIN
 FOR binding IN SELECT value FROM jsonb_array_elements(jsonb_build_array(CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END,CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END)) WHERE value<>'null'::jsonb LOOP
  references_json=coalesce(binding->'evidence',binding->'evidence_refs',binding->'trace','{}'::jsonb);
  FOR candidate IN SELECT r.organisation_id,r.job_id FROM public.survey_file_removals r WHERE r.organisation_id=(binding->>'organisation_id')::uuid AND EXISTS (
   SELECT 1 FROM (
    SELECT obj->>'id' AS identity FROM jsonb_array_elements(r.manifest->'objects') obj
    UNION SELECT m.client_generated_id FROM jsonb_array_elements(r.manifest->'objects') obj JOIN public.media_assets m ON m.organisation_id=r.organisation_id AND m.id::text=obj->>'id' WHERE obj->>'kind'='media'
    UNION SELECT a.id::text FROM jsonb_array_elements(r.manifest->'objects') obj JOIN public.media_analyses a ON a.organisation_id=r.organisation_id AND a.media_id::text=obj->>'id' WHERE obj->>'kind'='media'
   ) identities WHERE jsonb_path_query_array(references_json,'$.**.mediaId') ? identity OR jsonb_path_query_array(references_json,'$.**.analysisId') ? identity OR jsonb_path_query_array(references_json,'$.**.id') ? identity OR (references_json->'media') ? identity
  ) ORDER BY r.organisation_id,r.job_id LOOP
   PERFORM 1 FROM public.jobs j WHERE j.organisation_id=candidate.organisation_id AND j.id=candidate.job_id FOR UPDATE;
   IF EXISTS (SELECT 1 FROM public.survey_file_removals r WHERE r.organisation_id=candidate.organisation_id AND r.job_id=candidate.job_id AND r.status IN ('dispatched','verification_required','completed'))
   THEN RAISE EXCEPTION 'Extracted references to originals under removal cannot be added or changed'; END IF;
  END LOOP;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER task_reference_removal_fence BEFORE INSERT OR UPDATE OR DELETE ON assistant_tasks FOR EACH ROW EXECUTE FUNCTION guard_extracted_reference_under_original_removal();
CREATE TRIGGER proposal_reference_removal_fence BEFORE INSERT OR UPDATE OR DELETE ON field_proposals FOR EACH ROW EXECUTE FUNCTION guard_extracted_reference_under_original_removal();
CREATE TRIGGER report_reference_removal_fence BEFORE INSERT OR UPDATE OR DELETE ON report_versions FOR EACH ROW EXECUTE FUNCTION guard_extracted_reference_under_original_removal();
--> statement-breakpoint
CREATE FUNCTION guard_document_under_survey_file_removal() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE binding jsonb; candidate record; adding_hold boolean;
BEGIN
 adding_hold=TG_OP='UPDATE' AND NEW.legal_hold AND NOT OLD.legal_hold AND (to_jsonb(NEW)-'legal_hold'-'updated_at')=(to_jsonb(OLD)-'legal_hold'-'updated_at');
 FOR binding IN SELECT value FROM jsonb_array_elements(jsonb_build_array(CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END,CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END)) WHERE value<>'null'::jsonb LOOP
  FOR candidate IN SELECT DISTINCT j.organisation_id,j.id FROM public.jobs j WHERE j.organisation_id=(binding->>'organisation_id')::uuid AND (
   j.id::text=binding->>'job_id'
   OR EXISTS (SELECT 1 FROM public.report_versions v WHERE v.organisation_id=j.organisation_id AND v.job_id=j.id AND v.id::text=binding->>'report_version_id')
   OR EXISTS (SELECT 1 FROM public.survey_file_removals r,jsonb_array_elements(r.manifest->'objects') obj WHERE r.organisation_id=j.organisation_id AND r.job_id=j.id AND obj->>'kind'='document' AND obj->>'id'=binding->>'id')
  ) ORDER BY j.organisation_id,j.id LOOP
   PERFORM 1 FROM public.jobs j WHERE j.organisation_id=candidate.organisation_id AND j.id=candidate.id FOR UPDATE;
   IF NOT adding_hold AND EXISTS (SELECT 1 FROM public.survey_file_removals r WHERE r.organisation_id=candidate.organisation_id AND r.job_id=candidate.id AND r.status IN ('dispatched','verification_required','completed'))
   THEN RAISE EXCEPTION 'Documents under survey file removal cannot be changed or detached'; END IF;
  END LOOP;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER survey_file_document_removal_fence BEFORE INSERT OR UPDATE OR DELETE ON organisation_documents FOR EACH ROW EXECUTE FUNCTION guard_document_under_survey_file_removal();
