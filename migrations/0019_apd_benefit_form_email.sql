ALTER TABLE benefit_form_submissions ADD COLUMN email TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_benefit_form_email
  ON benefit_form_submissions(email);
