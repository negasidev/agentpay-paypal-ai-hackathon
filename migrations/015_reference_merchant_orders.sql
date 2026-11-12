CREATE TABLE IF NOT EXISTS ap_reference_merchant_orders (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL, user_id uuid NOT NULL, purchase_id uuid NOT NULL UNIQUE,
 quote_digest text NOT NULL CHECK(quote_digest ~ '^[a-f0-9]{64}$'),
 state text NOT NULL DEFAULT 'AWAITING_PAYMENT' CHECK(state IN ('AWAITING_PAYMENT','ACCEPTED_SANDBOX')),
 receipt_id uuid REFERENCES ap_receipts(id), accepted_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,user_id,purchase_id) REFERENCES ap_purchases(tenant_id,user_id,id),
 CHECK((state='AWAITING_PAYMENT' AND receipt_id IS NULL AND accepted_at IS NULL)
 OR (state='ACCEPTED_SANDBOX' AND receipt_id IS NOT NULL AND accepted_at IS NOT NULL))
);
