CREATE TABLE IF NOT EXISTS ap_authority_requests(
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,user_id uuid NOT NULL,purchase_id uuid NOT NULL UNIQUE,
 purchase_version integer NOT NULL,execution_id uuid NOT NULL UNIQUE,
 provider_order_id text NOT NULL,platform_intent_id text,platform_intent_version integer,
 envelope jsonb,state text NOT NULL CHECK(state IN ('REQUESTED','WAITING_HUMAN','SIGNED','VERIFIED','REJECTED','EXPIRED','REVOKED','UNAVAILABLE')),
 approval_request_id text,grant_id text,expires_at timestamptz,reason_code text,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,user_id,purchase_id) REFERENCES ap_purchases(tenant_id,user_id,id)
);
