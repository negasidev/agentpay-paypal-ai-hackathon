ALTER TABLE ap_attempts ADD COLUMN IF NOT EXISTS authority_consumed_at timestamptz;
ALTER TABLE ap_attempts ADD COLUMN IF NOT EXISTS dispatched_at timestamptz;
ALTER TABLE ap_attempts ADD COLUMN IF NOT EXISTS authority_envelope jsonb;
ALTER TABLE ap_attempts ADD COLUMN IF NOT EXISTS authority_grant jsonb;
ALTER TABLE ap_attempts ADD COLUMN IF NOT EXISTS purchase_version integer;
ALTER TABLE ap_receipts ADD COLUMN IF NOT EXISTS platform_receipt jsonb;
