ALTER TABLE ap_attempts ADD COLUMN IF NOT EXISTS reconciliation_count integer NOT NULL DEFAULT 0;
ALTER TABLE ap_attempts ADD COLUMN IF NOT EXISTS next_reconciliation_at timestamptz;
CREATE TABLE IF NOT EXISTS ap_provider_observations (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, user_id uuid NOT NULL,
 purchase_id uuid NOT NULL, attempt_id uuid NOT NULL, observed_at timestamptz NOT NULL DEFAULT now(),
 outcome text NOT NULL CHECK(outcome IN ('STARTED','UNKNOWN','CAPTURED','REFUSED')),
 metadata jsonb NOT NULL,
 FOREIGN KEY(tenant_id,user_id,purchase_id,attempt_id) REFERENCES ap_attempts(tenant_id,user_id,purchase_id,id)
);
CREATE TABLE IF NOT EXISTS ap_paypal_webhooks (
 event_id text PRIMARY KEY, payload_hash text NOT NULL, event_type text NOT NULL,
 order_id text, capture_id text, received_at timestamptz NOT NULL DEFAULT now(),
 processing_state text NOT NULL CHECK(processing_state IN ('UNMATCHED','QUEUED','PROCESSED'))
);
