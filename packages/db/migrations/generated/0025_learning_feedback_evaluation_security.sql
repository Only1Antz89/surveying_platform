ALTER TABLE learning_case_feedback ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE learning_case_feedback FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY learning_case_feedback_tenant_isolation ON learning_case_feedback FOR ALL
  USING (organisation_id = nullif(current_setting('app.current_organisation_id', true), '')::uuid)
  WITH CHECK (organisation_id = nullif(current_setting('app.current_organisation_id', true), '')::uuid);
--> statement-breakpoint
-- Feedback is a record of what a user said; it is not edited or used for training.
CREATE TRIGGER learning_case_feedback_immutable
  BEFORE UPDATE OR DELETE ON learning_case_feedback
  FOR EACH ROW EXECUTE FUNCTION prevent_immutable_mutation();
--> statement-breakpoint
GRANT SELECT, INSERT ON learning_restricted.evaluation_runs TO surveynt_learning_write;
--> statement-breakpoint
CREATE TRIGGER learning_evaluation_runs_immutable
  BEFORE UPDATE OR DELETE ON learning_restricted.evaluation_runs
  FOR EACH ROW EXECUTE FUNCTION public.prevent_immutable_mutation();
