# Family Helper

A voice-first family app (installable PWA for iPhone): reminders, vegetable bill checker, staff attendance & pay, and monthly payments.

See [docs/PLAN.md](docs/PLAN.md) for the full plan and build phases.

## Run locally

```bash
npm install
npm run dev
```

## Tests

```bash
npm test
```

## Status
- [x] Vegetable bill calculator (manual entry, remembered rates, vendor check)
- [x] Supabase auth + shared household
- [ ] Voice input (transcription + Claude parsing)
- [x] Staff attendance & pay
- [x] Monthly payments
- [x] Reminders + push notifications (daily 8 AM IST via Vercel Cron)

## Environment variables

| Name | Where it's used |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser + server |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Push notifications |
| `SUPABASE_SECRET_KEY` | Daily reminder job only (server) |
| `CRON_SECRET` | Protects `/api/cron/reminders` (Vercel sends it automatically) |
