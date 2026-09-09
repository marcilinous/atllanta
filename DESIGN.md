# DESIGN.md — Atllanta Design System

> **What this file is:** the source of truth for how Atllanta looks and how UI is
> built. Every view composes the tokens and components defined here. When a view
> and this file disagree, this file wins. Pairs with `CLAUDE.md` (product/architecture).
>
> **Stack rule (from CLAUDE.md §2):** vanilla HTML + CSS + JS. **No Tailwind, no
> React, no component libraries.** Style by composing CSS classes built on the
> tokens below — never token-laced inline `style=""` strings.

---

## 1. The memorable thing

> Calm, serious software that feels like **one system**, not four tools in a
> trench coat.

Every choice below serves that. Atllanta runs a company's people, hiring,
customers, and numbers in one place; the UI should feel dependable and quiet, with
just enough personality that a dashboard doesn't read like a stock admin template.

---

## 2. Color tokens

Base palette is **Professional Blue** on cool slate neutrals. Defined in
`css/tokens.css` on `:root`, overridden under `[data-theme="dark"]`.
**Reference tokens, never raw hex, in views and components.**

### Light (`:root`)
| Token | Value | Use |
|---|---|---|
| `--color-bg` | `#F8FAFC` | app background |
| `--color-bg-secondary` | `#F1F5F9` | canvas / inset panels |
| `--color-bg-tertiary` | `#E7ECF2` | tracks, hover fills |
| `--color-surface` | `#FFFFFF` | cards, sidebar, topbar |
| `--color-border` | `#E2E8F0` | card/input borders |
| `--color-border-light` | `#EEF1F6` | table row dividers |
| `--color-text-primary` | `#0F172A` | headings, body |
| `--color-text-secondary` | `#475569` | subtitles, labels |
| `--color-text-tertiary` | `#64748B` | meta, placeholders |
| `--color-accent` | *per module* (default `#1E3A8A`) | primary actions, active nav, links |
| `--color-on-accent` | `#FFFFFF` | text/icon **on** an accent fill (buttons, logo) |
| `--color-success` / `-light` | `#15803D` / `#ECFDF3` | positive states |
| `--color-warning` / `-light` | `#B45309` / `#FEF6E7` | attention states |
| `--color-error` / `-light` | `#B91C1C` / `#FEF0F0` | destructive/error |

### Dark (`[data-theme="dark"]`)
| Token | Value |
|---|---|
| `--color-bg` | `#0B1020` |
| `--color-bg-secondary` | `#121A2E` |
| `--color-surface` | `#121A2E` |
| `--color-border` | `#263149` |
| `--color-text-primary` | `#E2E8F0` |
| `--color-on-accent` | `#0B1020` (accents lighten on dark, so on-accent text flips to near-black) |

**Rule:** every color has its light definition on bare `:root`; dark only
*overrides*. Never define a color solely inside the dark block. Never put text
directly on an accent fill with `--color-text-inverse`; use `--color-on-accent`,
which flips per theme so button labels always pass contrast.

---

## 2a. Module accents (color that means "which module you're in")

Atllanta recolors **only the accent** based on the active module — neutrals never
move. `js/router.js` sets `data-module` on `<html>` per route; `tokens.css` maps
each module to its accent via `[data-module="…"]`. Every element already using
`var(--color-accent)` recolors automatically.

| Module | Light accent | Dark accent | Routes |
|---|---|---|---|
| Platform / default | `#1E3A8A` | `#3B82F6` | dashboard, inbox, settings, admin |
| Recruitment | `#1E3A8A` | `#3B82F6` | `recruitment/*` |
| People / HRMS | `#047857` (green) | `#10B981` | employees, people, attendance, leave, assets, documents, finance, helpdesk, me |
| CRM | `#2563EB` | `#38BDF8` | `crm/*` |
| Analytics | `#475569` (slate) | `#94A3B8` | `reports/*` |

Each accent has `-hover` and `-light` (tint for active-nav bg / focus ring).
**Color is never the only signal:** the module is always also named by the nav
label + icon, per WCAG 2.2 AA (color-blind safe). Light accents are all AA for
white text and as link text on white; dark accents are lightened for visibility on
the dark ground, which is why on-accent text flips to near-black.

---

## 3. Typography

**Inter only**, loaded once via Google Fonts in `index.html` / `login.html`
(reference spec: "Inter or similar — clean, modern, highly readable"). No display
face; hierarchy comes from scale + weight + space, not a second font.

| Token | Stack | Used for |
|---|---|---|
| `--font-sans` | `'Inter', -apple-system, BlinkMacSystemFont, sans-serif` | everything |
| `--font-mono` | `'JetBrains Mono', 'Fira Code', monospace` | code / ids |

### Scale (`--text-*`, rem)
`xs .75` · `sm .8125` · `base .875` (default UI) · `md 1` · `lg 1.125` ·
`xl 1.25` · `2xl 1.5` · `3xl 1.875`. Weights: `normal 400`, `medium 500`,
`semibold 600`, `bold 700`. Line-heights: `tight 1.25`, `normal 1.5`, `relaxed 1.625`.

**Visual hierarchy** (mined from design-principles): guide the eye with scale +
weight + space, not color alone. Blur-test any screen at 50% — the primary focal
point, the secondary info, and the one action should still be identifiable.

---

## 4. Spacing, radius, shadow, motion

- **Spacing** (`--space-1..16`, 4px base): `1=.25rem … 4=1rem … 8=2rem`.
  **Proximity rule** (gestalt): related items sit close (`--space-2`), unrelated
  groups get real separation (`--space-6`+). Equal spacing everywhere destroys
  grouping — the most common density mistake.
- **Radius:** `sm 5 · md 7 · lg 10 · xl 14 · full 9999`. Cards `lg`, inputs/buttons `md`, pills `full`.
- **Shadow:** `sm` hairline, `md` cards on hover/menus, `lg` modals. Keep shadows
  soft and warm-tinted; no hard drop shadows.
- **Motion:** `--transition-fast 150ms`, `--transition-normal 200ms`, `ease`.
  Animate color/opacity/transform only. Respect `prefers-reduced-motion`.

---

## 5. Components (compose these classes; don't reinvent)

Live in `css/components.css`. Canonical set: `button` (primary/secondary/ghost),
`input`, `table`, `modal`, `toast`, `card`, `badge`, `empty-state`, `skeleton`.

- **Buttons:** one primary per view. `.btn-primary` = accent; `.btn-secondary` =
  surface + border; `.btn-ghost` = text only. Height 40px, radius `md`.
- **Badges/pills:** calm, low-saturation — semantic tint bg + matching text +
  a 6px dot. Statuses map through `stagePill()`/`badge-*` in `js/ui.js`.
- **Cards:** surface + `--color-border` + radius `lg`; header row with a
  `semibold` title; body padding `--space-4`.
- **Tables:** uppercase `xs` tertiary headers, `--border-light` row dividers,
  dense rows (`--space-2/-3` padding). No zebra stripes.
- **Metrics:** label in `xs` uppercase tertiary; value in `bold ~2xl`; delta as
  plain `+3 / −2` in success/error (no triangles).

Reuse ladder before writing UI: a `js/ui.js` helper (`esc, toast, openModal,
formatDate, timeAgo, initials, avColor, scoreBar, stagePill, showError,
loadingSkeleton`) → a `components.css` class → a native element. New CSS is the
last resort.

---

## 6. Icons

**One system: inline SVG**, 24×24 viewBox, `stroke="currentColor"`,
`stroke-width="2"`, `fill="none"` (Feather style). Size 18–20px in chrome.

**No emoji as UI icons — ever.** (Removes the emoji notification icons at
`index.html:370`.) Emoji render differently per OS and break the one-system feel.

---

## 7. Dark mode contract

Theme is set by `data-theme` on `<html>`, persisted in `localStorage`
(`atllanta-theme`), toggled in the user menu. Every surface must be explicit —
never rely on a transparent background. Both themes ship together; a component is
not done until it's checked in both.

---

## 8. Accessibility (WCAG 2.1 AA — non-negotiable)

Mined from LibreUIUX `accessibility-compliance`.

- **Contrast:** body text ≥ 4.5:1, large text/UI ≥ 3:1, against its actual
  background in *both* themes. Verify the accent-on-white and accent-on-dark pairs.
- **Focus:** every interactive element has a visible focus ring
  (`box-shadow: 0 0 0 3px var(--color-accent-light)`); never `outline:none`
  without a replacement.
- **Semantics/ARIA:** nav has `role="navigation"` + `aria-label`; icon-only
  buttons carry `aria-label`; modals trap focus, close on Esc, restore focus
  (already in `openModal`, `js/ui.js`).
- **Targets:** interactive hit area ≥ 40×40px.
- **Escape hatch:** every user-rendered string passes `esc()` (XSS + correctness).

---

## 9. Anti-slop rules (what the audit found — do not repeat)

1. **No token-laced inline styles.** `style="display:flex;gap:var(--space-2)…"`
   repeated across views is the #1 slop. Use the layout utilities in
   `components.css` instead — `.u-row`, `.u-row-3`, `.u-row-wrap`, `.u-stack`,
   `.u-stack-4`, `.u-center`, `.u-muted`, `.u-meta`, `.u-sm-muted` — or add a
   component class. (~1,700 inline styles to unwind incrementally; new views add zero.)
2. **No emoji icons** (see §6).
3. **No re-hand-rolled helpers.** Import `esc/timeAgo/initials/avColor` from
   `js/ui.js`; don't paste local copies (e.g. `index.html`).
4. **One vocabulary.** One button set, one badge set, one card shape. If a screen
   needs a new pattern, add it here first, then use it.

---

## 9a. Navigation — the Back control (global rule)

A "Back" control ALWAYS returns the user to their **previous page** (browser
history), never a hardcoded route. Render it with `backButton()` from `js/ui.js`,
or put `data-back` on the control; a global handler (`js/ui.js`) calls
`history.back()`, falling back to the element's `href` (then the dashboard) only
on a fresh load with no history.

```js
import { backButton } from '../../js/ui.js';
// in a page header:
`${backButton('crm')}`            // "← Back"; 'crm' is only the fresh-load fallback
// or, on any element:
`<a href="#/crm" class="btn btn-secondary" data-back>← Back</a>`
```

Do NOT hardcode a back destination (`<a href="#/crm">← CRM</a>`). Label it
"← Back", not the name of a specific screen. Wizard/step "Back" buttons (moving to
a previous step, not a previous page) are exempt.

## 10. How to build UI (Define → Build → Review → Refine)

From LibreUIUX `premium-saas-design`, adapted:
1. **Define** — name the screen's one job and its primary action before styling.
2. **Build** — compose tokens + components; match surrounding code's density.
3. **Review** — blur-test hierarchy; check both themes; run the a11y checks in §8;
   `/design-review` or `/ui-review` for a second pass.
4. **Refine** — cut, don't add. If a screen has two focal points, it has none.

---

## 11. Provenance

Restyle (Space Grotesk display + indigo accent + warmed neutrals + sharpened
components) approved by the owner from a live preview. Principles in §3, §4, §8,
§10 are mined from the MIT-licensed `HermeticOrmus/LibreUIUX-Claude-Code`,
translated out of its Tailwind examples into Atllanta's token model. The LibreUIUX
toolkit is installed globally for other (non-Atllanta) projects; it is **not**
wired into this repo.
