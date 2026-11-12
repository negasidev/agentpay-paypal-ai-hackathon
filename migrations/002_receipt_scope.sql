DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ap_attempts_scoped_id' AND conrelid='ap_attempts'::regclass) THEN
    ALTER TABLE ap_attempts ADD CONSTRAINT ap_attempts_scoped_id UNIQUE(tenant_id,user_id,purchase_id,id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ap_receipts_scoped_attempt' AND conrelid='ap_receipts'::regclass) THEN
    ALTER TABLE ap_receipts ADD CONSTRAINT ap_receipts_scoped_attempt
      FOREIGN KEY(tenant_id,user_id,purchase_id,attempt_id)
      REFERENCES ap_attempts(tenant_id,user_id,purchase_id,id);
  END IF;
END $$;
