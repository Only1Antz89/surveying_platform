CREATE TABLE invoice_credits (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
 invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT, request_id uuid NOT NULL, number text NOT NULL,
 amount_minor integer NOT NULL, vat_minor integer NOT NULL, reason text NOT NULL, evidence text NOT NULL, fingerprint text NOT NULL,
 issued_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT invoice_credits_amount_chk CHECK (amount_minor > 0 AND vat_minor >= 0 AND vat_minor <= amount_minor)
);
--> statement-breakpoint
CREATE UNIQUE INDEX invoice_credits_org_request_uidx ON invoice_credits(organisation_id,request_id);
CREATE UNIQUE INDEX invoice_credits_org_number_uidx ON invoice_credits(organisation_id,number);
CREATE INDEX invoice_credits_invoice_idx ON invoice_credits(invoice_id);
ALTER TABLE invoice_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_credits FORCE ROW LEVEL SECURITY;
CREATE POLICY invoice_credits_tenant ON invoice_credits USING (organisation_id = nullif(current_setting('app.current_organisation_id',true),'')::uuid) WITH CHECK (organisation_id = nullif(current_setting('app.current_organisation_id',true),'')::uuid);
--> statement-breakpoint
CREATE FUNCTION invoice_credit_validate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bill invoices%ROWTYPE; gross bigint; vat bigint;
BEGIN
 SELECT * INTO bill FROM invoices WHERE id=NEW.invoice_id AND organisation_id=NEW.organisation_id FOR UPDATE;
 IF NOT FOUND OR bill.status IN ('draft','void') THEN RAISE EXCEPTION 'Credit requires an issued invoice from the same practice'; END IF;
 IF NOT EXISTS (SELECT 1 FROM organisation_memberships WHERE organisation_id=NEW.organisation_id AND user_id=NEW.issued_by_user_id AND active AND role IN ('owner','administrator','manager','finance')) THEN RAISE EXCEPTION 'Credit requires an active finance reviewer'; END IF;
 SELECT coalesce(sum(amount_minor),0),coalesce(sum(vat_minor),0) INTO gross,vat FROM invoice_credits WHERE invoice_id=NEW.invoice_id;
 IF gross+NEW.amount_minor>bill.total_minor OR vat+NEW.vat_minor>bill.vat_minor OR gross+NEW.amount_minor-vat-NEW.vat_minor>bill.subtotal_minor THEN RAISE EXCEPTION 'Credit exceeds original gross, VAT or net invoice amount'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER invoice_credit_validate BEFORE INSERT ON invoice_credits FOR EACH ROW EXECUTE FUNCTION invoice_credit_validate();
CREATE FUNCTION invoice_credit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Issued invoice credits are immutable'; END $$;
CREATE TRIGGER invoice_credit_immutable BEFORE UPDATE OR DELETE ON invoice_credits FOR EACH ROW EXECUTE FUNCTION invoice_credit_immutable();
