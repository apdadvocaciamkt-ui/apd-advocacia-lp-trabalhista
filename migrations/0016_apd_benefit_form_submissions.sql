CREATE TABLE IF NOT EXISTS benefit_form_submissions (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL DEFAULT '',
  q1 TEXT NOT NULL CHECK (q1 IN ('q1_o1', 'q1_o2', 'q1_o3')),
  q2 TEXT NOT NULL CHECK (q2 IN ('q2_o1', 'q2_o2', 'q2_o3', 'q2_o4')),
  q3 TEXT NOT NULL CHECK (q3 IN ('q3_o1', 'q3_o2', 'q3_o3')),
  q4 TEXT NOT NULL CHECK (q4 IN ('q4_o1', 'q4_o2', 'q4_o3')),
  source_path TEXT NOT NULL DEFAULT '/beneficio-assistencial/',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_benefit_form_created
  ON benefit_form_submissions(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_benefit_form_session
  ON benefit_form_submissions(session_id);
