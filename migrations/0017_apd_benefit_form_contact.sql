ALTER TABLE benefit_form_submissions ADD COLUMN name TEXT NOT NULL DEFAULT '';
ALTER TABLE benefit_form_submissions ADD COLUMN phone TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_benefit_form_phone
  ON benefit_form_submissions(phone);
