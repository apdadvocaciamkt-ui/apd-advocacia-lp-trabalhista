ALTER TABLE benefit_form_submissions ADD COLUMN name TEXT NOT NULL DEFAULT '';
ALTER TABLE benefit_form_submissions ADD COLUMN phone TEXT NOT NULL DEFAULT '';
ALTER TABLE benefit_form_submissions ADD COLUMN crm_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE benefit_form_submissions ADD COLUMN crm_contact_id TEXT NOT NULL DEFAULT '';
ALTER TABLE benefit_form_submissions ADD COLUMN crm_error TEXT NOT NULL DEFAULT '';
ALTER TABLE benefit_form_submissions ADD COLUMN crm_synced_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_benefit_form_phone
  ON benefit_form_submissions(phone);

CREATE INDEX IF NOT EXISTS idx_benefit_form_crm_status
  ON benefit_form_submissions(crm_status, created_at DESC);
