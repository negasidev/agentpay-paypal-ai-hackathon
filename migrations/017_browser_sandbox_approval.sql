CREATE TABLE IF NOT EXISTS ap_browser_sandbox_approvals (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 user_id uuid NOT NULL,
 purchase_id uuid NOT NULL,
 session_hash text NOT NULL,
 statement text NOT NULL,
 terms_hash text NOT NULL,
 public_key jsonb NOT NULL,
 key_thumbprint text NOT NULL,
 challenge_expires_at timestamptz NOT NULL,
 approval_expires_at timestamptz NOT NULL,
 signature text,
 approved_at timestamptz,
 revoked_at timestamptz,
 consumed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,user_id,purchase_id) REFERENCES ap_purchases(tenant_id,user_id,id)
);
CREATE INDEX IF NOT EXISTS ap_browser_sandbox_approvals_purchase ON ap_browser_sandbox_approvals(purchase_id,created_at DESC);
CREATE TABLE IF NOT EXISTS ap_browser_sandbox_executions (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 user_id uuid NOT NULL,
 purchase_id uuid NOT NULL UNIQUE,
 approval_id uuid NOT NULL UNIQUE REFERENCES ap_browser_sandbox_approvals(id),
 provider_order_id text NOT NULL UNIQUE,
 provider_request_id uuid NOT NULL UNIQUE,
 state text NOT NULL CHECK(state IN ('PENDING','UNKNOWN','COMPLETED','REFUSED')),
 dispatched_at timestamptz,
 receipt jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,user_id,purchase_id) REFERENCES ap_purchases(tenant_id,user_id,id)
);
