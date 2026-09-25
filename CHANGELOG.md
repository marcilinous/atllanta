# Changelog

All notable changes to Atllanta, newest first. Versions are MAJOR.MINOR.PATCH:
MINOR adds or changes a feature, PATCH only fixes, MAJOR breaks data, tenancy or
behaviour users would notice. Each version is tagged `vX.Y.Z` on the commit that
was promoted to production.

## v1.3.0 — 2026-09-25

### What changed
- Everyone is signed out once when this release goes live, and signs back in as usual. Your session now lives in a cookie shared by the whole app, so the new screens being built alongside the current ones see the same signed-in account.
- Password reset links now work from any device: the link opens a page with a Continue button that confirms the reset on the server, then you choose a new password. A link can no longer be used up by an email scanner opening it first.
- Your light/dark theme choice now also applies to the new screens from the first moment they load.

### Admins need to
- Nothing in the app. Before going live, the Atllanta team switches the password-reset email to the new link format — see the release checklist.

## v1.2.6 — 2026-09-25

### What changed
- The dashboard's activity feed shows recent activity again. Its query had been refused by the database on every visit, so only posts and announcements appeared.
- The People → Letters list of generated letters loads again, with the name of whoever generated each one — including people who have since left.

### Admins need to
- Nothing.

## v1.2.5 — 2026-09-25

### What changed
- Security: automatic follow-ups (leave approvals, attendance, expense and hiring notifications) now act only on records in your own organisation, and only on what the record actually says. Before, a crafted request could make them update another organisation's attendance or leave balances, or treat a leave request as approved before a manager approved it.
- Leave days are deducted once per approved request, never again for the same request.
- Notification emails no longer render text from records as formatting.
- People who have left an organisation can no longer invite users, bulk-import, or connect Google Calendar with a still-valid session.

### Admins need to
- Nothing.

## v1.2.4 — 2026-09-24

### What changed
- Security: a server report endpoint returned attendance, leave and hiring data from every organisation, not just yours, to any signed-in owner, admin or manager who called it directly. Nothing in the app used it; it has been removed. The Reports screens were never affected — they read through the database's access rules.
- Security: a server notification endpoint let any owner or admin send an email with their own content to any address, and a notification to any user in any organisation. Nothing in the app used it; it has been removed. Automatic notifications are unchanged.
- Security: connecting Google Calendar is now tied to the browser that started it. Before, someone could send you a Google consent link that, once approved, attached your calendar to their account. Your session token is also no longer placed in the link to Google.

### Admins need to
- If Google Calendar connect is in use: set `GOOGLE_OAUTH_REDIRECT_URI` to `https://atllanta.vercel.app/api/google-auth?action=callback` in Vercel (Production) and register the same URL in the Google Cloud OAuth client. The connection now has to return to the same site it started on.

## v1.2.3 — 2026-09-23

### What changed
- Organisation settings save again: renaming your organisation and changing its logo were silently refused by the database. Only owners and admins can make those changes, as the screen already said.
- Only owners and admins can create invitations now. A member could previously add one, including one that granted admin access.

### Admins need to
- Nothing.

## v1.2.2 — 2026-09-22

### What changed
- Security: a person's organisation can no longer be changed from inside the app, by anyone, including owners and admins. Atllanta assigns it; before this fix an owner or admin could move their own account into another organisation.
- Security: inviting an email that already belongs to another organisation is now refused instead of moving that person into yours. The message doesn't say which organisation the email belongs to.
- The audit log no longer shows internal organisation identifiers in its Details column.

### Admins need to
- Nothing. If you invite someone who already has an account with another organisation, they need a different email address for yours.

## v1.2.1 — 2026-09-19

### What changed
- Behind the scenes, Atllanta now runs on a new foundation (Next.js) that future screens will be built on. Every screen, link, sign-in and AI feature works exactly as before; nothing looks or behaves differently.
- Returning visitors get a fresh copy of the app on their next visit, so nobody keeps a stale cached version.

### Admins need to
- Nothing.

## v1.2.0 — 2026-09-17

### What changed
- Recruitment AI (reading resumes, parsing job descriptions, matching and AI screening) now counts AI tokens against your organisation's monthly quota and each person's daily limit, instead of credits. Credits are no longer deducted.
- If a limit is reached, the screen says so ("You've used today's AI limit. It resets at midnight." or "Your organisation's monthly AI quota is used up. It resets on the 1st.").
- AI screening handles up to 50 candidates per run; candidates without resume text don't count toward the 50. Run "Unscored only" again for the rest.
- Unusual bursts of AI requests pause that person's AI for 10 minutes and notify the organisation's owners and admins.
- Matching and job-description parsing now check that the job and candidate belong to your organisation.

### Admins need to
- Nothing for existing organisations: they start with 2,000,000 AI tokens a month and 200,000 per person per day. New organisations start with 2,000 tokens a month until the platform owner raises it.

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
