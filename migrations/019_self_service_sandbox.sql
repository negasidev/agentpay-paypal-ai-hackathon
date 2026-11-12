CREATE TABLE IF NOT EXISTS ap_sandbox_registrations (
 id uuid PRIMARY KEY, email text NOT NULL, full_name text NOT NULL, password_hash text NOT NULL,
 token_hash text NOT NULL, expires_at timestamptz NOT NULL, used_at timestamptz,
 attempts integer NOT NULL DEFAULT 0, delivery_state text NOT NULL DEFAULT 'PENDING', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ap_sandbox_registrations_email ON ap_sandbox_registrations(email,created_at);
CREATE TABLE IF NOT EXISTS ap_sandbox_profiles (
 user_id uuid PRIMARY KEY REFERENCES ap_users(id), tenant_id uuid NOT NULL, full_name text NOT NULL,
 email_verified_at timestamptz NOT NULL, FOREIGN KEY(tenant_id,user_id) REFERENCES ap_users(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS ap_sandbox_workspaces (
 tenant_id uuid PRIMARY KEY, owner_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,owner_id) REFERENCES ap_users(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS ap_sandbox_mail_events (
 id uuid PRIMARY KEY, tenant_id uuid, user_id uuid, purchase_id uuid, kind text NOT NULL,
 state text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), provider_id text
);
ALTER TABLE ap_browser_sandbox_approvers DROP CONSTRAINT IF EXISTS ap_browser_sandbox_approvers_identity_kind_check;
ALTER TABLE ap_browser_sandbox_approvers ADD CONSTRAINT ap_browser_sandbox_approvers_identity_kind_check CHECK(identity_kind IN ('named-account','shared-evaluation','verified-workspace-owner'));
