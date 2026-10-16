-- Payees can be paid weekly as well as monthly, and carry a short note
-- (e.g. "₹2,000–3,000 a week").
alter table public.payees
  add column if not exists frequency text not null default 'monthly'
    check (frequency in ('monthly', 'weekly')),
  add column if not exists note text;
