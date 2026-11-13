CREATE TABLE IF NOT EXISTS benefit_form_crm_sync (
  event_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending',
  contact_id TEXT NOT NULL DEFAULT '',
  error_code TEXT NOT NULL DEFAULT '',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  attempted_at INTEGER,
  synced_at INTEGER,
  FOREIGN KEY (event_id) REFERENCES benefit_form_submissions(event_id)
);

CREATE INDEX IF NOT EXISTS idx_benefit_form_crm_sync_status
  ON benefit_form_crm_sync(status, attempted_at);

INSERT OR IGNORE INTO benefit_form_crm_sync (event_id, status)
SELECT event_id, 'pending'
FROM benefit_form_submissions;
