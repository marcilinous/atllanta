# Changelog

All notable changes to Atllanta, newest first. Versions are MAJOR.MINOR.PATCH:
MINOR adds or changes a feature, PATCH only fixes, MAJOR breaks data, tenancy or
behaviour users would notice. Each version is tagged `vX.Y.Z` on the commit that
was promoted to production.

## v1.2.0 — 2026-09-17

### What changed
- Recruitment AI (reading resumes, parsing job descriptions, matching and AI screening) now counts AI tokens against your organisation's monthly quota and each person's daily limit, instead of credits. Credits are no longer deducted.
- If a limit is reached, the screen says so ("You've used today's AI limit. It resets at midnight." or "Your organisation's monthly AI quota is used up. It resets on the 1st.").
- AI screening handles up to 50 candidates per run; candidates without resume text don't count toward the 50. Run "Unscored only" again for the rest.
- Unusual bursts of AI requests pause that person's AI for 10 minutes and notify the organisation's owners and admins.
- Matching and job-description parsing now check that the job and candidate belong to your organisation.

### Admins need to
- Nothing. Every organisation starts with 2,000,000 AI tokens a month and 200,000 per person per day.

## v1.1.0 — 2026-09-17

### What changed
- Behind the scenes, Atllanta can now record AI usage per organisation, user and feature; hold a monthly AI token quota per organisation and a daily limit per user; and pause a user's AI for 10 minutes when their use looks automated. Nothing uses this yet, so AI features behave exactly as before.
- Every existing organisation starts with 2,000,000 AI tokens a month (stops at the limit) and a default of 200,000 tokens a day per user. New organisations start with 2,000 tokens a month.

### Admins need to
- Nothing.

## v1.0.2 — 2026-09-17

### What changed
- Internal documents, database files and test files are no longer downloadable from the website. Only the files the app needs are published.

### Admins need to
- Nothing.

## v1.0.1 — 2026-09-17

### What changed
- The app now shows its version at the bottom of the account menu (click your avatar), so you can always tell which release you are using.
- After a release, the app fetches its version fresh instead of from its offline cache, and old cached files are cleared, so the label always shows the release you are on.

### Admins need to
- Nothing.

## v1.0.0 — 2026-09-17

Baseline: the release running in production on 2026-09-17 (commit `3b5f39b`).

### What changed
- Events and audit entries are saved again, so leave, expense, helpdesk and recruitment notifications fire, and each event is processed once.
- The daily background job runs, requires a secret, and recovers events that got stuck.
- Resume parsing, candidate extraction, matching and screening use Groq's current model (`openai/gpt-oss-120b`).
- The AI assistant is switched off until it reads data only as the signed-in user.

### Admins need to
- Nothing.
