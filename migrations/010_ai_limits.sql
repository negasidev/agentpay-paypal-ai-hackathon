CREATE INDEX IF NOT EXISTS ap_ai_proposals_created_at_idx ON ap_ai_proposals(created_at);
CREATE INDEX IF NOT EXISTS ap_ai_proposals_active_idx ON ap_ai_proposals(state) WHERE state='GENERATING';
