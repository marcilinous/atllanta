# Changelog

All notable changes to Atllanta, newest first. Versions are MAJOR.MINOR.PATCH:
MINOR adds or changes a feature, PATCH only fixes, MAJOR breaks data, tenancy or
behaviour users would notice. Each version is tagged `vX.Y.Z` on the commit that
was promoted to production.

## v1.0.1 — 2026-09-17

### What changed
- The app now shows its version at the bottom of the account menu (click your avatar), so you can always tell which release you are using.

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
