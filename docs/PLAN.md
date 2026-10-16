# Family App — Plan

## Context
A personal, family-shared app (iPhones) that removes three daily frictions:
1. **Reminders** — birthdays, anniversaries, bills, anything recurring.
2. **Vegetable bill check** — speak "tomato 40 a kilo, 750 grams" for each item; app computes each line and the total so vendor rounding/guesswork is caught.
3. **Maid/cleaner attendance** — mark absences quickly, and compute monthly pay after allowed leaves.
4. **Monthly payments** — track what's paid/pending each month to maids, dry cleaner, gardener, cleaner and other regular payees.

Primary goal: very easy to use → **one big mic button**, speak naturally in English or Manglish/Hinglish, app figures out what you meant and shows it for a one-tap confirm.

Folder: `/Users/teenaanie/Documents/Claude/Projects/FamilyApp` (currently empty).

## Evaluation & recommendation

**Build it as a PWA (installable web app), not a native iOS app — for v1.**
- Same stack you already use (Next.js + Supabase + Vercel, as in Pippy / Dè Stories / teaching platform) → fastest to build and maintain.
- "Add to Home Screen" on iPhone gives an app icon, full screen, and **Web Push notifications** (supported on iOS 16.4+ for home-screen apps) — enough for reminders.
- No App Store, no $99/yr developer account, instant updates for the whole family.
- Native iOS (Swift) is worth it later only if you want Siri ("Hey Siri, Lakshmi is absent today"), offline voice, or rock-solid notifications. A cheap middle step: an Apple **Shortcut** that opens the app straight into voice mode.

**Voice: don't rely on the browser's built-in speech recognition.** Safari's is unreliable and poor at Manglish. Instead:
1. Record audio in the app (tap-and-hold mic).
2. Send to a speech-to-text model (OpenAI `gpt-4o-transcribe` / Whisper — handles Indian English & code-mixing well).
3. Send transcript to Claude (Haiku 4.5, cheap/fast) with tool-use to return **structured JSON** + detected intent (veg / reminder / attendance).
4. **The app's own code does all arithmetic** — the AI only extracts item, rate, rate-unit, quantity. Never trust an LLM to multiply money.
5. Show the result as an editable card → user taps ✓.

Rough running cost: well under ₹200/month for family use. Supabase + Vercel free tiers suffice.

## Features

### 1. Universal voice button (home screen)
One mic. Examples it must handle:
- "Tomato forty rupees kilo, 750 grams; onion 250 gram 15 rupees; 2 kilo potato at 30"
- "Remind me to pay KSEB bill on the 5th every month"
- "Amma's birthday is March 12"
- "Lakshmi didn't come today" / "Sunita absent yesterday"
Router decides the intent; each module also has its own mic for unambiguous use.

### 2. Vegetable bill calculator
- Line item: name, rate, rate basis (per kg / per 250 g / per 500 g / per piece / per bunch), quantity + unit → line price.
- Normalise everything to grams internally: `price = rate × qty_g / basis_g`, rounded to 2 decimals; total at bottom, big font.
- "Vendor said ₹___" field → shows the difference in red/green.
- Add more items by voice mid-list; swipe to delete; tap any number to fix it.
- Remembers last rate per vegetable (suggests it next time) → over time, a personal price history.
- Save bill (date, vendor name optional) for history; or just discard.
- Fallback when signal is poor at the market: quick manual entry with number pad.

### 3. Reminders
- Types: birthday, anniversary, bill, custom. Recurrence: once / monthly / yearly / every N days.
- Lead times: e.g. bills 3 days before + on the day; birthdays 1 day before + morning of.
- Shared across family (everyone gets the push) or private.
- Mark bill "paid" → stops nagging until next cycle.
- Delivery: Supabase `pg_cron` runs every morning (e.g. 8 AM IST) → Edge Function finds due reminders → sends Web Push to each family member's device.

### 4. Staff attendance & pay
- Staff profile: name, role (maid/cleaner/cook), working days (e.g. Mon–Sat), monthly salary, allowed paid leaves/month.
- Default = present; you only mark **absences** (voice or tap a calendar day). Half-day option.
- Month view calendar per person.
- Month-end summary: days absent, extra leaves beyond allowance, per-day rate (salary ÷ working days in month), deduction, **payable amount**. Mark "paid" with date.
- Optional: advances given (deducted from salary).

### 5. Monthly payments tracker
- One list of everyone/everything you pay monthly: maids, dry cleaner, gardener, cleaner, newspaper, milk, building maintenance, etc.
- Each payee: name, category, expected amount (fixed, or "calculated" for staff linked to attendance), due day of month.
- Monthly checklist view: who's paid ✓, who's pending, total paid vs. total expected this month.
- Record a payment by voice: "Paid gardener 1500 today", "Gave Lakshmi 2000 advance". Fields: amount, date, mode (cash/UPI), note.
- Staff salaries pull the **payable amount** from attendance (feature 4) so you pay the right figure.
- Pending payments automatically become reminders (feature 3) near the due day.
- History per payee and a simple month-by-month total.

### 6. Family / accounts
- Supabase Auth with email magic link (already have Resend/SMTP experience). One "household"; invite spouse/family by email.
- Row-level security: everything scoped to household.

## Tech design

- **Frontend:** Next.js (App Router) + Tailwind, PWA manifest + service worker, mobile-first, large touch targets.
- **Backend:** Supabase (Postgres, Auth, Edge Functions, pg_cron). Next.js API route `/api/voice` holds AI keys server-side.
- **AI:** OpenAI transcription → Claude Haiku 4.5 with tools `add_veg_items`, `create_reminder`, `mark_absence`; Pydantic-style JSON schema validation; ask for clarification if a field is missing (e.g. no rate given).
- **Push:** Web Push (VAPID keys), subscriptions stored per device.

### Tables (sketch)
`households`, `members` · `reminders` (title, type, date, recurrence, lead_days[], shared, last_done) · `push_subscriptions` · `veg_bills`, `veg_items` (name, rate, basis_g, qty_g, price) · `veg_rates` (name → last rate) · `payees` (name, category, amount, due_day, linked staff_id nullable) · `payments` (payee_id, month, amount, paid_on, mode, note, is_advance) · `staff` (name, role, salary, work_days, paid_leaves) · `attendance` (staff_id, date, status).

## Build phases
1. **Skeleton** — Next.js PWA, Supabase project, auth, household invite, deploy to Vercel, install on your iPhone.
2. **Vegetable calculator** (most immediate pain) — manual entry first, then voice; unit tests for the price maths.
3. **Attendance + monthly payments** — staff and payee setup, attendance calendar, salary calc, monthly paid/pending checklist; voice "X absent today", "paid gardener 1500".
4. **Reminders + push** — CRUD, recurrence, cron + push; birthdays/bills seeded by voice.
5. **Universal mic + polish** — intent router, rate history, bill history, Apple Shortcut for one-tap voice.

## Verification
- Unit tests for veg price math (250 g basis, piece-based, rounding) and pay calc (month lengths, holidays, half-days, advances).
- Fixture set of ~20 spoken phrases (English + Manglish) → assert parsed JSON matches expected.
- Manual test on iPhone: install to Home Screen, record at the vendor, confirm push arrives for a test reminder due "today".
- Preview via dev server in the browser pane for UI checks.

## Open decisions (can decide while building)
- App name / icon.
- Whether reminders also go via WhatsApp/email as a backup to push.
