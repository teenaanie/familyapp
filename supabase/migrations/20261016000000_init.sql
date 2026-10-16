-- Family Helper: initial schema.
-- Everything belongs to a household; members of that household can read/write it.

-- ───────────── Households & members ─────────────
create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Our home',
  created_at timestamptz not null default now()
);

create table public.members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index members_user_idx on public.members(user_id);

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  unique (household_id, email)
);

-- Security definer so RLS policies can check membership without recursing into members' own policy.
create or replace function public.is_member(hid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.members m
    where m.household_id = hid and m.user_id = (select auth.uid())
  );
$$;

-- Called right after sign-in: joins any households that invited this email,
-- or creates a new household if the user belongs to none. Returns the household id.
create or replace function public.ensure_household(p_display_name text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  user_email text := (select lower(email) from auth.users where id = uid);
  hid uuid;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;

  insert into public.members (household_id, user_id, display_name)
  select i.household_id, uid, p_display_name
  from public.invites i
  where lower(i.email) = user_email
  on conflict do nothing;
  delete from public.invites where lower(email) = user_email;

  select household_id into hid from public.members where user_id = uid order by created_at limit 1;
  if hid is null then
    insert into public.households default values returning id into hid;
    insert into public.members (household_id, user_id, display_name) values (hid, uid, p_display_name);
  end if;
  return hid;
end;
$$;

revoke execute on function public.ensure_household(text) from public, anon;
grant execute on function public.ensure_household(text) to authenticated;
revoke execute on function public.is_member(uuid) from public, anon;
grant execute on function public.is_member(uuid) to authenticated;

-- ───────────── Staff & attendance ─────────────
create table public.staff (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  role text,                                   -- maid, cleaner, cook, gardener…
  monthly_salary numeric(10,2) not null default 0,
  work_days smallint[] not null default '{1,2,3,4,5,6}', -- 0=Sun … 6=Sat
  paid_leaves_per_month numeric(4,1) not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.attendance (
  staff_id uuid not null references public.staff(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  day date not null,
  status text not null check (status in ('absent', 'half_day', 'extra')),
  note text,
  primary key (staff_id, day)
);
create index attendance_household_day_idx on public.attendance(household_id, day);

-- ───────────── Monthly payments ─────────────
create table public.payees (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  category text,                               -- staff, dry cleaner, newspaper, milk…
  expected_amount numeric(10,2),               -- null = varies / calculated
  due_day smallint check (due_day between 1 and 31),
  staff_id uuid references public.staff(id) on delete set null, -- salary computed from attendance
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  payee_id uuid not null references public.payees(id) on delete cascade,
  for_month date not null,                     -- first day of the month it settles
  amount numeric(10,2) not null check (amount >= 0),
  paid_on date not null default current_date,
  mode text check (mode in ('cash', 'upi', 'bank', 'other')),
  is_advance boolean not null default false,
  note text,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index payments_household_month_idx on public.payments(household_id, for_month);
create index payments_payee_idx on public.payments(payee_id);

-- ───────────── Reminders & push ─────────────
create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  title text not null,
  kind text not null default 'custom' check (kind in ('birthday', 'anniversary', 'bill', 'custom')),
  due_date date not null,                      -- next occurrence
  recurrence text not null default 'none' check (recurrence in ('none', 'monthly', 'yearly', 'every_n_days')),
  every_n_days smallint,
  lead_days smallint[] not null default '{0}', -- e.g. {3,0} = 3 days before and on the day
  shared boolean not null default true,
  owner_id uuid references auth.users(id) default auth.uid(),
  payee_id uuid references public.payees(id) on delete set null,
  done_for date,                               -- occurrence marked done/paid
  created_at timestamptz not null default now()
);
create index reminders_household_due_idx on public.reminders(household_id, due_date);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

-- ───────────── Vegetable bills ─────────────
create table public.veg_rates (
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  rate numeric(10,2) not null,
  rate_qty numeric(10,3) not null,
  rate_unit text not null,
  updated_at timestamptz not null default now(),
  primary key (household_id, name)
);

create table public.veg_bills (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  vendor text,
  total numeric(10,2) not null,
  vendor_asked numeric(10,2),
  bought_on date not null default current_date,
  created_at timestamptz not null default now()
);

create table public.veg_items (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.veg_bills(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  rate numeric(10,2) not null,
  rate_qty numeric(10,3) not null,
  rate_unit text not null,
  qty numeric(10,3) not null,
  qty_unit text not null,
  price numeric(10,2) not null
);
create index veg_items_bill_idx on public.veg_items(bill_id);
create index veg_bills_household_idx on public.veg_bills(household_id, bought_on);

-- ───────────── Row-level security ─────────────
alter table public.households enable row level security;
alter table public.members enable row level security;
alter table public.invites enable row level security;
alter table public.staff enable row level security;
alter table public.attendance enable row level security;
alter table public.payees enable row level security;
alter table public.payments enable row level security;
alter table public.reminders enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.veg_rates enable row level security;
alter table public.veg_bills enable row level security;
alter table public.veg_items enable row level security;

create policy "members read household" on public.households
  for select to authenticated using (public.is_member(id));
create policy "members rename household" on public.households
  for update to authenticated using (public.is_member(id));

create policy "members see each other" on public.members
  for select to authenticated using (public.is_member(household_id));
create policy "edit own member row" on public.members
  for update to authenticated using (user_id = (select auth.uid()));

create policy "members manage invites" on public.invites
  for all to authenticated
  using (public.is_member(household_id)) with check (public.is_member(household_id));

-- Same household-scoped policy for every data table.
do $$
declare t text;
begin
  foreach t in array array['staff','attendance','payees','payments','veg_rates','veg_bills','veg_items'] loop
    execute format(
      'create policy "household access" on public.%I for all to authenticated
         using (public.is_member(household_id)) with check (public.is_member(household_id))', t);
  end loop;
end $$;

create policy "household reminders" on public.reminders
  for all to authenticated
  using (public.is_member(household_id) and (shared or owner_id = (select auth.uid())))
  with check (public.is_member(household_id));

create policy "own push subscriptions" on public.push_subscriptions
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Explicit grants (RLS above still decides which rows).
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke all on all tables in schema public from anon;
