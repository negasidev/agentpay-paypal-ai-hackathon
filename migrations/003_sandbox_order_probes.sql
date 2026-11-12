CREATE TABLE IF NOT EXISTS ap_sandbox_order_probes(
  purchase_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  request_id uuid NOT NULL UNIQUE,
  merchant_id text NOT NULL,
  provider_order_id text UNIQUE,
  state text NOT NULL CHECK(state IN ('PENDING','UNKNOWN','VERIFIED')),
  verified_at timestamptz,
  provider_status text,
  FOREIGN KEY(tenant_id,user_id,purchase_id) REFERENCES ap_purchases(tenant_id,user_id,id)
);
ALTER TABLE ap_sandbox_order_probes ADD COLUMN IF NOT EXISTS provider_status text;
