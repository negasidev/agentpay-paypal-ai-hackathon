ALTER TABLE ap_purchases ADD COLUMN IF NOT EXISTS quantity integer NOT NULL DEFAULT 1 CHECK(quantity BETWEEN 1 AND 3);
CREATE TABLE IF NOT EXISTS ap_ai_proposals (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, user_id uuid NOT NULL,
 request_id uuid NOT NULL, input_hash text NOT NULL, instruction text NOT NULL,
 budget text NOT NULL, state text NOT NULL CHECK(state IN ('GENERATING','READY','FAILED')),
 provider text NOT NULL, model text NOT NULL, proposal jsonb, provenance jsonb,
 purchase_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,user_id,request_id),
 FOREIGN KEY(tenant_id,user_id) REFERENCES ap_users(tenant_id,id),
 FOREIGN KEY(tenant_id,user_id,purchase_id) REFERENCES ap_purchases(tenant_id,user_id,id)
);
