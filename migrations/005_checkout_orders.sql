ALTER TABLE ap_orders ADD COLUMN IF NOT EXISTS purchase_version integer;
ALTER TABLE ap_orders ADD COLUMN IF NOT EXISTS amount text;
ALTER TABLE ap_orders ADD COLUMN IF NOT EXISTS currency text;
ALTER TABLE ap_orders ADD COLUMN IF NOT EXISTS merchant_id text;
ALTER TABLE ap_orders ADD COLUMN IF NOT EXISTS buyer_status text NOT NULL DEFAULT 'NOT_APPROVED' CHECK(buyer_status IN ('NOT_APPROVED','CANCELED','APPROVED'));
ALTER TABLE ap_orders ADD COLUMN IF NOT EXISTS provider_status text;
ALTER TABLE ap_orders ADD COLUMN IF NOT EXISTS verified_at timestamptz;
CREATE TABLE IF NOT EXISTS ap_checkout_creations(
 purchase_id uuid PRIMARY KEY, tenant_id uuid NOT NULL,user_id uuid NOT NULL,
 request_id uuid NOT NULL UNIQUE,purchase_version integer NOT NULL,
 amount text NOT NULL,currency text NOT NULL,merchant_id text NOT NULL,
 state text NOT NULL CHECK(state IN ('UNKNOWN','CREATED')),
 FOREIGN KEY(tenant_id,user_id,purchase_id) REFERENCES ap_purchases(tenant_id,user_id,id)
);
