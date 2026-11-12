CREATE TABLE IF NOT EXISTS ap_browser_sandbox_approvers (
 tenant_id uuid NOT NULL,
 user_id uuid NOT NULL,
 display_name text NOT NULL CHECK(length(display_name) BETWEEN 1 AND 120),
 permission text NOT NULL CHECK(permission='approve-own-sandbox-purchase'),
 revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,user_id),
 FOREIGN KEY(tenant_id,user_id) REFERENCES ap_users(tenant_id,id)
);
ALTER TABLE ap_browser_sandbox_approvals ADD COLUMN IF NOT EXISTS credential_fingerprint text;
ALTER TABLE ap_browser_sandbox_approvals ADD COLUMN IF NOT EXISTS approver_name text;
ALTER TABLE ap_browser_sandbox_approvers ADD COLUMN IF NOT EXISTS authorization_version uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE ap_browser_sandbox_approvals ADD COLUMN IF NOT EXISTS approver_version uuid;
ALTER TABLE ap_browser_sandbox_approvers ADD COLUMN IF NOT EXISTS identity_kind text NOT NULL DEFAULT 'named-account' CHECK(identity_kind IN ('named-account','shared-evaluation'));
