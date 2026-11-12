CREATE TABLE IF NOT EXISTS ap_identity_link_flows (
  token_hash text PRIMARY KEY,
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  context_kind text NOT NULL CHECK(context_kind IN ('personal','organization')),
  code_verifier text,
  consumed boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL,
  FOREIGN KEY(tenant_id,user_id) REFERENCES ap_users(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS ap_identity_links (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  issuer text NOT NULL,
  canonical_tenant_id uuid NOT NULL,
  canonical_subject_id uuid NOT NULL,
  context_kind text NOT NULL CHECK(context_kind IN ('personal','organization')),
  linked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(issuer,canonical_tenant_id,canonical_subject_id),
  UNIQUE(tenant_id,user_id,canonical_tenant_id),
  FOREIGN KEY(tenant_id,user_id) REFERENCES ap_users(tenant_id,id)
);
