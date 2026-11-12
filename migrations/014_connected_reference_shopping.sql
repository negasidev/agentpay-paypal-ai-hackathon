ALTER TABLE ap_purchases ADD COLUMN IF NOT EXISTS quote_digest text;
ALTER TABLE ap_purchases ADD COLUMN IF NOT EXISTS quote jsonb;
ALTER TABLE ap_workflow_tasks DROP CONSTRAINT IF EXISTS ap_workflow_tasks_state_check;
ALTER TABLE ap_workflow_tasks ADD CONSTRAINT ap_workflow_tasks_state_check
 CHECK(state IN ('OPTIONS_READY','REVIEW_READY','HANDOFF_READY','CANCELED','PURCHASE_PREPARED'));
CREATE TABLE IF NOT EXISTS ap_task_purchases (
 tenant_id uuid NOT NULL, user_id uuid NOT NULL, task_id uuid NOT NULL,
 purchase_id uuid NOT NULL UNIQUE, review_digest text NOT NULL,
 PRIMARY KEY(tenant_id,user_id,task_id),
 FOREIGN KEY(tenant_id,user_id,task_id) REFERENCES ap_workflow_tasks(tenant_id,user_id,id),
 FOREIGN KEY(tenant_id,user_id,purchase_id) REFERENCES ap_purchases(tenant_id,user_id,id)
);
