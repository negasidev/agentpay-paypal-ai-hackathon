CREATE TABLE IF NOT EXISTS ap_trust_replay_probes (
 id uuid NOT NULL, tenant_id uuid NOT NULL, user_id uuid NOT NULL,
 purchase_id uuid NOT NULL, input_hash text NOT NULL,
 original_terms jsonb NOT NULL, attempted_terms jsonb NOT NULL,
 decision text NOT NULL CHECK(decision IN ('TERMS_MISMATCH','TERMS_MATCH_INSPECTION_ONLY')),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,user_id,id),
 FOREIGN KEY(tenant_id,user_id,purchase_id) REFERENCES ap_purchases(tenant_id,user_id,id)
);
