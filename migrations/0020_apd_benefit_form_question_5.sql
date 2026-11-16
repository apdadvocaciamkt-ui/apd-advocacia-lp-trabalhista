ALTER TABLE benefit_form_submissions
ADD COLUMN q5 TEXT NOT NULL DEFAULT ''
CHECK (q5 IN ('', 'q5_o1', 'q5_o2', 'q5_o3', 'q5_o4', 'q5_o5'));
