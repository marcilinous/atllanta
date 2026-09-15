ALTER TABLE job_applications
  ADD COLUMN IF NOT EXISTS interview_questions JSONB;

ALTER TABLE job_applications
  ADD COLUMN IF NOT EXISTS interview_questions_at TIMESTAMPTZ;

COMMENT ON COLUMN job_applications.interview_questions IS
  'Groq-generated interview guide: {questions:[{category,question,why,strong_answer,follow_up}], focus_areas:[], generated_for:{job_title,candidate_name}}';
COMMENT ON COLUMN job_applications.interview_questions_at IS
  'When the interview questions were last generated (drives the "regenerate" affordance in the UI).';

ALTER TABLE credit_ledger DROP CONSTRAINT IF EXISTS credit_ledger_action_type_check;
ALTER TABLE credit_ledger ADD CONSTRAINT credit_ledger_action_type_check
  CHECK (action_type IN (
    'resume_match',
    'interview_questions',
    'whatsapp_message',
    'topup',
    'monthly_reset'
  ));