CREATE OR REPLACE FUNCTION guard_extracted_reference_under_original_removal() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE binding jsonb; references_json jsonb; candidate record;
BEGIN
 FOR binding IN SELECT value FROM jsonb_array_elements(jsonb_build_array(CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END,CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END)) WHERE value<>'null'::jsonb LOOP
  references_json=jsonb_build_array(binding->'evidence',binding->'evidence_refs',binding->'proposed_value',binding->'trace',binding->'value',binding->'structured',jsonb_build_object('id',binding->>'source_ref'));
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
    IF TG_TABLE_NAME='report_versions' AND TG_OP='UPDATE' AND public.authorised_report_retention_disposition(to_jsonb(OLD),to_jsonb(NEW),candidate.organisation_id,candidate.job_id) THEN CONTINUE; END IF;
    RAISE EXCEPTION 'Extracted references to originals under removal cannot be added or changed'; END IF;
  END LOOP;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;

--> statement-breakpoint
CREATE TRIGGER field_value_reference_removal_fence BEFORE INSERT OR UPDATE OR DELETE ON survey_field_values FOR EACH ROW EXECUTE FUNCTION guard_extracted_reference_under_original_removal();
--> statement-breakpoint
CREATE TRIGGER observation_reference_removal_fence BEFORE INSERT OR UPDATE OR DELETE ON observations FOR EACH ROW EXECUTE FUNCTION guard_extracted_reference_under_original_removal();
