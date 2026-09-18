# Recruitment & Interview Automation module

Job description in, ranked candidates out, interviews booked without email ping-pong.
This is the module customers arrive for, and the only module that spends AI tokens
outside the assistant.

---

## 1. Screens

| Route | File | Purpose |
|---|---|---|
| `recruitment` / `recruitment/jobs` | `views/recruitment/jobs.js` (648) | job list, create job, bulk resume upload, screening dialog |
| `recruitment/job` | `views/recruitment/job-detail.js` | one job: JD, parsed skills, applicants, scores |
| `recruitment/candidate` | `views/recruitment/candidate-profile.js` | one candidate: resume, scores, interview history |
| `recruitment/shortlist` | `views/recruitment/shortlist.js` | move candidates through stages |
| `recruitment/upload` | `views/recruitment/upload-resumes.js` | standalone resume upload |
| `recruitment/matcher` | `views/recruitment/matcher.js` | ad-hoc JD ↔ resume comparison |
| `recruitment/interviews` | `views/recruitment/interviews.js` (470) | schedule and track interviews |
| public | `schedule.html` + `api/schedule.js` | candidate self-booking by token, no login |

## 2. Tables

`jobs` (JD text, `parsed_skills`, status), `candidates` (resume text, contact, FTS),
`job_applications` (the join row: `match_score`, `match_summary`, `match_raw_response`,
`status`), `interviews`, `interview_slots`.

`job_applications` is the workhorse: one row per candidate per job, and every AI score
lands on it. `candidates.org_id` and `jobs.org_id` are both required for tenant checks —
matching must verify **both**.

## 3. The AI flow (v1.2.0 onward)

```
upload file → api/parse-resume        (free: unpdf / mammoth → text)
            → api/extract-candidate   (AI: candidate_extract, 300 tokens)
create job  → api/parse-resume?action=parse-jd (AI: jd_parse, 1024 tokens)
score one   → api/match               (AI: match, 600 tokens)
score many  → api/screen-job          (AI: screen, 600 tokens per candidate, ≤50 per run)
                                       or method="python": free keyword + TF-IDF
```

Every AI call goes through `lib/aiGateway.js` (see `ai.md`). Rules that already bit us:

- **Credits are gone.** Nothing reads or writes `credits_balance` / `credit_ledger`.
  Usage is counted in tokens against the org's monthly quota and the user's daily limit.
- **Ownership before anything:** load the job, check `job.org_id === caller.orgId`, check
  `candidate.org_id === caller.orgId`, and only then create the application row or call AI.
- **Screening batches:** ordered by `id`, capped at 50 AI-eligible candidates per run;
  candidates without resume text are reported ("No resume text") and don't consume a slot.
  After the first refusal (429) or failure (502/503) the rest of the batch is marked with
  that message and no further AI calls are made.
- **Bulk upload keeps working when AI is unavailable:** text extraction is free, so the
  candidate is still created with the file name as its name. After the first refusal the
  loop stops calling AI for that batch and shows the message once.
- **Keyword screening is always available** — it costs nothing and needs no quota.

## 4. Interview scheduling

- `api/google-auth.js` runs a **per-user** Google OAuth flow; tokens live in
  `user_google_tokens`. `lib/googleMeet.js` creates the Meet link.
- `api/schedule.js` is public by design: a candidate gets a tokenised link, sees only
  their slots, and books one. Links expire after 24 hours. Treat this endpoint as
  internet-facing: no data beyond the job title and the offered slots may leak.

## 5. Events

`recruitment.candidate.shortlisted` drives the hiring-manager notification and the
interview task. Interview booking and stage changes publish their own events; grep
`publishEvent(` in `views/recruitment/` for the current set before relying on one.

## 6. Working notes

- Prompts live inline in the endpoints and are deliberately unchanged from the versions
  that work — improve the surrounding code, not the prompt text (CLAUDE.md §11).
- `match.js` and `screen-job.js` share the same scoring prompt. The duplication is
  known and accepted; if you change one, change both or extract carefully.
- `mode: "all"` re-screens the first 50 by id every run; "Unscored only" is how a user
  works through a long list. The UI says "50 per run".
- The AI model is `openai/gpt-oss-120b` with `reasoning_effort: "low"` — only
  `lib/aiGateway.js` may name it, and `tests/groq-model.test.mjs` enforces that.
