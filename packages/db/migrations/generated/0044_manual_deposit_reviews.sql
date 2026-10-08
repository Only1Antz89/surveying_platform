CREATE OR REPLACE FUNCTION manual_payment_review_validate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM client_payments p WHERE p.id=NEW.payment_id AND p.invoice_id=NEW.invoice_id AND p.organisation_id=NEW.organisation_id AND p.purpose IN ('manual','manual_balance','manual_deposit')) THEN
  RAISE EXCEPTION 'Manual payment review must belong to the same practice and invoice';
 END IF;
 IF EXISTS (SELECT 1 FROM client_payments p WHERE p.id=NEW.payment_id AND p.purpose='manual_deposit') AND NOT EXISTS (
  SELECT 1 FROM client_payments p JOIN invoices i ON i.id=p.invoice_id JOIN customer_quotes q ON q.id=p.quote_id
  WHERE p.id=NEW.payment_id AND i.quote_id=q.id AND i.organisation_id=NEW.organisation_id AND q.organisation_id=NEW.organisation_id
    AND i.number=q.reference || '-D' AND i.total_minor=q.deposit_minor
 ) THEN
  RAISE EXCEPTION 'Manual deposit evidence requires the original quote deposit invoice';
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
