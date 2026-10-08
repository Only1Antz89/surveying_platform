CREATE TABLE manual_payment_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
 invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT, payment_id uuid NOT NULL REFERENCES client_payments(id) ON DELETE RESTRICT,
 request_id uuid NOT NULL, kind text NOT NULL CHECK (kind IN ('receipt','refund')), method text NOT NULL CHECK (method IN ('bank_transfer','cash','cheque','external_card')),
 reference text NOT NULL, evidence text NOT NULL, amount_minor integer NOT NULL CHECK (amount_minor > 0), occurred_at timestamptz NOT NULL,
 fingerprint text NOT NULL, verified_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX manual_payment_reviews_org_request_uidx ON manual_payment_reviews(organisation_id,request_id);
CREATE UNIQUE INDEX manual_payment_reviews_invoice_reference_uidx ON manual_payment_reviews(organisation_id,invoice_id,kind,reference);
CREATE INDEX manual_payment_reviews_payment_idx ON manual_payment_reviews(payment_id);
ALTER TABLE manual_payment_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE manual_payment_reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY manual_payment_reviews_tenant ON manual_payment_reviews USING (organisation_id = nullif(current_setting('app.current_organisation_id',true),'')::uuid) WITH CHECK (organisation_id = nullif(current_setting('app.current_organisation_id',true),'')::uuid);
--> statement-breakpoint
CREATE FUNCTION manual_payment_review_validate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM client_payments p WHERE p.id=NEW.payment_id AND p.invoice_id=NEW.invoice_id AND p.organisation_id=NEW.organisation_id AND p.purpose IN ('manual','manual_balance')) THEN
  RAISE EXCEPTION 'Manual payment review must belong to the same practice and invoice';
 END IF;
 IF NEW.kind='receipt' AND NOT EXISTS (SELECT 1 FROM client_payments p WHERE p.id=NEW.payment_id AND p.amount_minor=NEW.amount_minor AND p.succeeded_at=NEW.occurred_at) THEN
  RAISE EXCEPTION 'Receipt evidence must match the verified payment';
 END IF;
 IF NEW.kind='refund' AND NEW.amount_minor + COALESCE((SELECT sum(r.amount_minor) FROM manual_payment_reviews r WHERE r.payment_id=NEW.payment_id AND r.kind='refund'),0) > (SELECT p.refunded_minor FROM client_payments p WHERE p.id=NEW.payment_id) THEN
  RAISE EXCEPTION 'Refund evidence exceeds the verified refund total';
 END IF;
 IF EXISTS (SELECT 1 FROM client_payments p WHERE p.id=NEW.payment_id AND (p.stripe_payment_intent_id IS NOT NULL OR p.stripe_checkout_session_id IS NOT NULL)) THEN
  RAISE EXCEPTION 'Stripe payments cannot be manually verified';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM organisation_memberships m WHERE m.user_id=NEW.verified_by_user_id AND m.organisation_id=NEW.organisation_id AND m.active AND m.role IN ('owner','administrator','manager','finance')) THEN
  RAISE EXCEPTION 'Manual payment review requires an active finance member';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER manual_payment_review_validate BEFORE INSERT ON manual_payment_reviews FOR EACH ROW EXECUTE FUNCTION manual_payment_review_validate();
CREATE FUNCTION manual_payment_review_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Manual payment reviews are immutable'; END $$;
CREATE TRIGGER manual_payment_review_immutable BEFORE UPDATE OR DELETE ON manual_payment_reviews FOR EACH ROW EXECUTE FUNCTION manual_payment_review_immutable();
