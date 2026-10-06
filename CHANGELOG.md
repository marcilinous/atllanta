# Changelog

All notable changes to Atllanta, newest first. Versions are MAJOR.MINOR.PATCH:
MINOR adds or changes a feature, PATCH only fixes, MAJOR breaks data, tenancy or
behaviour users would notice. Each version is tagged `vX.Y.Z` on the commit that
was promoted to production.

## v1.15.1 — 2026-10-07

### What changed
- **Expense claims are private.** A claim (and its receipt) is now seen only by the person who made it, owners and admins, their managers, and their department's manager — the same people who see their leave. Before, every colleague could read every claim.
- **Managers can approve and reject claims.** Their Approve and Reject buttons used to say "Expense approved" while nothing changed; now they work for the people they manage. Nobody can approve their own claim, and an owner's or admin's claim needs another owner or admin.
- **Only owners and admins mark a claim reimbursed**, and only once it's approved.
- **A claim can't be changed after it's submitted**, and can be withdrawn only while it's still pending. Approved and reimbursed claims (and their receipts) stay on record.

### Admins need to
- Nothing.

## v1.15.0 — 2026-10-06

### What changed
- **Send feedback** from the account menu (or from the "trial ended" page): pick Idea, Problem or Praise, rate us if you like, and tell us more. It goes privately to the Atllanta team — nobody in your company sees it.
- For the Atllanta platform owner: a **Feedback** tab on the platform screen, and a bell notification for each new entry.

### Admins need to
- Nothing.

## v1.14.1 — 2026-10-05

### What changed
- The home page now shows Atllanta's 30-second launch film in "See it in action". It plays silently when you scroll to it; press **Sound on** to hear it. Nothing extra downloads unless you scroll that far.

### Admins need to
- Nothing.

## v1.14.0 — 2026-10-05

### What changed
- **atllanta.com now has a home page.** Visitors who aren't signed in see what Atllanta is, with **Start free trial** and **Sign in**. If you're signed in, atllanta.com opens the app as before.
- **Sign-up is open:** "Start free trial" (or "Sign up" on the sign-in page) creates a new company with Google, on a 14-day free trial.
- Old links into the app and password-reset links still take you to sign-in.

### Admins need to
- Nothing.

## v1.13.0 — 2026-10-05

### What changed
- **Free trials now end.** A company whose 14-day trial has ended, or which Atllanta has paused, sees a "trial ended" page instead of the app until Atllanta reactivates it. Owners and admins see how to contact us; everyone else is asked to speak to their admin. Nothing is deleted — everything is back as soon as access is restored.
- **Existing companies are unaffected:** all are now marked active.
- Admins can no longer change their company's plan, trial dates or credits directly — those are managed by Atllanta.
- New for the Atllanta platform owner: a **Companies** page to activate a company, extend its trial (7, 14 or 30 days, within its limit) or pause it.

### Admins need to
- Nothing.

## v1.12.0 — 2026-10-05

### What changed
- **Company sign-up is ready, but not open to the public yet.** A Google account that doesn't belong to any company is taken to a short set-up. There they name the company, pick the time zone and currency, and choose which modules to switch on. They start as its owner on a 14-day trial, with Casual, Sick and Earned leave already set up.
- The "Sign up" link on the sign-in page stays hidden until trial management is in place. Email-and-password sign-up comes once email is set up for atllanta.com. Signing in is unchanged.
- If your account can't be loaded (for example, a dropped connection), you now see a "Try again" message instead of a blank or looping page.
- People you invite are not affected — they join your company as before.

### Admins need to
- Owner: in Supabase → Authentication → URL Configuration → Redirect URLs, add `https://atllanta.com/**` and `https://www.atllanta.com/**` so Google sign-in returns to the new domain.

## v1.11.0 — 2026-10-04

### What changed
- **Attendance has moved to the new attendance screen.** Opening Attendance (or Check-in, or Regularize) now takes you to the new screen: check in and check out, your last 30 days, asking for a correction, and your corrections. Managers and admins also get Approvals there, plus who has checked in today.
- The month heatmap is still available from the new screen's **Overview** tab. The attendance report hasn't moved and is linked from the **Report** tab.
- The Inbox's Regularization tab and the check-in button on the Me page work as before.

### Admins need to
- Nothing. If something looks wrong on the new attendance screen, tell us. The old one can be switched back.

## v1.10.0 — 2026-10-04

### What changed
- **New attendance screen, in preview** at `/hrms/attendance`. The current attendance screens are unchanged and still the ones the app opens. Try the new one and tell us if anything is off before we switch over.
  - **My attendance:** check in and check out for today, your last 30 days, and "Request a correction" on any day, with the times you want and a reason. Your corrections and their status are listed underneath.
  - **Approvals** (managers, admins and owners): approve or reject corrections. Approving now fixes the times on that day in the same step. You never see your own. An owner's or admin's correction goes to an admin or another owner.
  - **Checked in today:** who has checked in, with their times.
  - The overview heatmap and the attendance report are still the current screens, linked from the tabs.
- A manager is now told when someone asks for a correction on the new screen. The current screen sent the notice under a name nothing listened to.
- Fixed: after checking in from the **Me** page, the button kept saying "Check In", and clicking it again showed a "duplicate key" error. The check-in was always saved. The button now changes to "Check Out" straight away.

### Admins need to
- Nothing.

## v1.9.1 — 2026-09-30

### What changed
- Security: attendance can no longer be changed from outside the app's screens. Before, any signed-in person could mark a colleague present, change their own check-in time, approve their own regularisation, or create work schedules.
- You check in and out for yourself, at the time you do it. To change your own attendance afterwards, ask for a regularisation.
- Nobody approves their own regularisation. An owner's or admin's is approved by an admin or another owner; everyone else's by an admin, their reporting manager, or a manager over their department.
- Only owners and admins can create or change work schedules.

### Admins need to
- Nothing.

## v1.9.0 — 2026-09-30

### What changed
- **Leave has moved to the new leave screen.** Opening Leave (or following any link to it) now takes you to the new screen: your balances, requesting leave, your requests and cancelling, and — for managers and admins — Approvals.
- Team calendar and the leave report are still where they were, linked from the new screen's tabs. Leave settings and balance adjustments are unchanged, under Admin.
- You can't request leave on dates you already have pending or approved leave.

### Admins need to
- Nothing. If something looks wrong on the new leave screen, tell us — the old one can be switched back.

## v1.8.0 — 2026-09-30

### What changed
- **Uploading documents works again.** Attaching a document to a leave request (Sick leave needs one), an expense receipt, or an employee document was failing because the storage area for them didn't exist. Files are private and only visible to the right people.
- **A new leave screen, in preview** at `/hrms/leave`: your balances, requesting leave (with a document where the leave type needs one), your requests, and cancelling a pending one. Managers and admins get an Approvals tab. The current leave screens are unchanged and stay the default until we switch over.
- On the new screen you can't request leave on dates you already have pending or approved leave.

### Admins need to
- Nothing yet. Try the new screen at `/hrms/leave` if you like; we'll tell you before it replaces the current one.

## v1.7.1 — 2026-09-29

### What changed
- Security: leave can no longer be misused from outside the app's screens. Before, any signed-in person could approve their own leave, change their own or a colleague's leave balance, add company holidays, or send a request already marked approved.
- Nobody can approve or reject their own leave. An owner's or admin's leave is approved by an admin or another owner; everyone else's by an admin, their reporting manager, or a manager over their department — as the approvals screen already shows.
- Only the person who asked can cancel a leave request, and only while it is pending. A request can't be edited after it is sent.
- Leave balances and holidays can only be changed by owners and admins.
- Approved leave is always deducted from the right balance exactly once, from the request itself.

### Admins need to
- If your organisation has no admin, an owner's leave can only be approved by another owner — consider making a trusted person an admin.

## v1.7.0 — 2026-09-29

### What changed
- **Developer is now a role you can give people.** It appears in User Management (invite and change role) and in the employee import.
- A developer can manage the developer tools — API keys, webhooks and integrations — and read the audit log.
- A developer can open the Admin panel, but only sees Modules & roles, Organization Settings, Integrations and the Audit Log. Organisation settings and Modules & roles are view-only for them.
- Everywhere else a developer has the same access as a Member. They can't change billing or financial settings, and can't remove people.

### Admins need to
- Nothing. Give someone the Developer role under Admin → User Management when you want them to have it.

## v1.6.0 — 2026-09-29

### What changed
- **Modules you haven't switched on are now hidden.** The switches under **Admin → Modules & roles → Modules** take effect: a module that is off disappears from the sidebar and its pages can't be opened — for everyone in your organisation, owners and admins included.
- The dashboard, reports, the Admin panel, your settings and the audit log are not modules and are always there, so an owner or admin can always switch a module back on.
- The CRM page opens if either CRM or Partner CRM is on, and only shows the sections you can open.
- If the list of switched-on modules can't be loaded, the app shows every module as before rather than hiding them.

### Admins need to
- Check **Admin → Modules & roles → Modules**: anything left off is now hidden for everyone in your organisation.

## v1.5.0 — 2026-09-29

### What changed
- New for owners and admins: **Admin → Modules & roles → Members** lets you give a person one of your custom roles, or take it away. A custom role changes what they may do in the modules it lists; everywhere else their built-in role (Owner, Admin, Manager, Member, Developer) still applies.
- Nobody can change their own role, and only an owner can change an owner's.
- Built-in roles are still changed where they always were, under Admin → User Management.

### Admins need to
- Nothing. Custom roles only take effect for people you assign them to.

## v1.4.3 — 2026-09-28

### What changed
- The dashboard's activity feed no longer shows admin settings changes (a module switched on or off, a custom role created, changed or deleted). They were appearing to everyone as "enabled module" without saying which. They are still recorded, and still in the audit log.

### Admins need to
- Nothing.

## v1.4.2 — 2026-09-28

### What changed
- Nothing you can see. Switching a module on or off, and creating, changing or deleting a custom role, are now covered by tests end to end: each change is recorded once and then marked done, with no other effect.

### Admins need to
- Nothing.

## v1.4.1 — 2026-09-27

### What changed
- Security: only owners, admins and developers can read your organisation's audit log. Before, any member could read it through the app's data connection, even though the Audit Log screen was already limited to admins.
- Developers can now open the Audit Log screen.

### Admins need to
- Nothing.

## v1.4.0 — 2026-09-26

### What changed
- New for owners and admins: the **Modules & roles** card in the Admin panel (the shield icon in the sidebar) opens three new screens.
  - **Modules** — switch on the modules your organisation uses (People, CRM, Recruitment, Analytics and so on). They all start switched off, and switching them doesn't hide anything yet. A later release will make the switches take effect, and we'll tell you before it does.
  - **Roles** — create custom roles that change what someone may do (view, create, edit, delete, approve) in specific modules. The built-in roles are listed for reference and can't be changed. Assigning a custom role to people comes in a later release.
  - **Feature access** — hide sections of the app from a role or from one person. This is the "Access" screen that went missing, back with the same rules your organisation already had.
- Pages on the new screens are never served from the app's offline cache, so what you see after a change is always current.

### Admins need to
- Open **Admin → Modules & roles** and switch on every module your organisation uses, before the release that enforces them.

## v1.3.4 — 2026-09-26

### What changed
- Nothing you can see yet. The new screens now have one place that decides what each person may do in each module, based on their role, any custom role, and which modules the organisation has switched on. It is not yet used by any screen.

### Admins need to
- Nothing.

## v1.3.3 — 2026-09-26

### What changed
- Nothing you can see yet. This release lays the groundwork for switching modules on and off per organisation and for custom roles: every organisation now has its five built-in roles and a list of 13 modules, all switched off and not yet enforced.
- A Developer role now exists alongside Owner, Admin, Manager and Member (not yet assignable from the app).

### Admins need to
- Nothing yet. Before modules are enforced, you'll get a settings screen to switch on the ones your organisation uses.

## v1.3.2 — 2026-09-26

### What changed
- Security: only an owner can make someone an owner or change an owner's role. Before, any admin could promote themselves or anyone else to owner, or demote the owner.
- Nobody can change their own role any more — an owner hands over ownership by promoting someone else, who can then change the previous owner's role.
- Admins no longer see "Owner" in the role and invite menus, and your own role shows as a label instead of a menu.

### Admins need to
- Nothing. If you need an owner changed, ask an owner.

## v1.3.1 — 2026-09-25

### What changed
- Security: the public status page no longer shows how many organisations and users Atllanta has in total. It now only says whether the database is reachable.

### Admins need to
- Nothing.

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
