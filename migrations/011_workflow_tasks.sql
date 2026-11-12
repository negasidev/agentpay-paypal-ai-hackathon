ALTER TABLE ap_ai_proposals ADD COLUMN IF NOT EXISTS workflow_id text;
CREATE TABLE IF NOT EXISTS ap_workflow_tasks (
 tenant_id uuid NOT NULL, user_id uuid NOT NULL, id uuid NOT NULL,
 workflow_id text NOT NULL, workflow_version text NOT NULL,
 input_hash text NOT NULL, revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 state text NOT NULL CHECK(state IN ('OPTIONS_READY','REVIEW_READY','HANDOFF_READY','CANCELED')),
 discovery jsonb NOT NULL, selection jsonb, review_digest text,
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
 PRIMARY KEY(tenant_id,user_id,id),
 FOREIGN KEY(tenant_id,user_id) REFERENCES ap_users(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS ap_workflow_task_events (
 tenant_id uuid NOT NULL, user_id uuid NOT NULL, task_id uuid NOT NULL,
 revision integer NOT NULL, event text NOT NULL, observed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,user_id,task_id,revision),
 FOREIGN KEY(tenant_id,user_id,task_id) REFERENCES ap_workflow_tasks(tenant_id,user_id,id)
);
CREATE INDEX IF NOT EXISTS ap_workflow_tasks_owner_created_idx
 ON ap_workflow_tasks(tenant_id,user_id,created_at DESC);
