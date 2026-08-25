-- ATLLANTA — AI-generated candidate-specific interview questions (Phase 1)
--
-- Questions are generated per APPLICATION (candidate × job), not per candidate:
-- the same person interviewing for two roles should get two different question
-- sets, each grounded in that job's JD and in the gaps the screening step found.
--
-- Stored as JSONB alongside the existing match_* columns rather than in a new
-- table — same lifetime as the application row, and it inherits the existing
-- job_applications RLS policy with no extra policy surface.

ALTER TABLE job_applications
  ADD COLUMN IF NOT EXISTS interview_questions JSONB;

ALTER TABLE job_applications
  ADD COLUMN IF NOT EXISTS interview_questions_at TIMESTAMPTZ;

COMMENT ON COLUMN job_applications.interview_questions IS
  'Groq-generated interview guide: {questions:[{category,question,why,strong_answer,follow_up}], focus_areas:[], generated_for:{job_title,candidate_name}}';
COMMENT ON COLUMN job_applications.interview_questions_at IS
  'When the interview questions were last generated (drives the "regenerate" affordance in the UI).';

-- Generating a question set costs one credit, so the ledger needs to be able to
-- name that action. The existing constraint only allows the four original types.
ALTER TABLE credit_ledger DROP CONSTRAINT IF EXISTS credit_ledger_action_type_check;
ALTER TABLE credit_ledger ADD CONSTRAINT credit_ledger_action_type_check
  CHECK (action_type IN (
    'resume_match',
    'interview_questions',
    'whatsapp_message',
    'topup',
    'monthly_reset'
  ));
