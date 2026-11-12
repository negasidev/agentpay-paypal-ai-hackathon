CREATE TABLE IF NOT EXISTS ap_canonical_login_flows (
 state_hash text PRIMARY KEY, browser_hash text NOT NULL, code_verifier text,
 context_kind text NOT NULL CHECK(context_kind IN ('personal','organization')),
 return_path text NOT NULL, expires_at timestamptz NOT NULL, consumed boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS ap_canonical_sessions (
 token_hash text PRIMARY KEY REFERENCES ap_sessions(token_hash) ON DELETE CASCADE,
 link_id uuid NOT NULL REFERENCES ap_identity_links(id), tokens_ciphertext text NOT NULL,
 state text NOT NULL CHECK(state IN ('ACTIVE','REFRESHING','REAUTH_REQUIRED'))
);
