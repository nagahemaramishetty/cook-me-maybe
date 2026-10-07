-- Cook Me Maybe: run this whole file once in Supabase → SQL Editor → New query → Run

-- 1) Your fridge items
create table if not exists public.items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,
  expiry_date date not null,
  cooked      boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists items_user_expiry_idx on public.items (user_id, expiry_date);

-- 2) Devices that should get push notifications
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

-- 3) Security: each person can only see and change their own rows
alter table public.items enable row level security;
alter table public.push_subscriptions enable row level security;

drop policy if exists "own items" on public.items;
create policy "own items" on public.items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own subscriptions" on public.push_subscriptions;
create policy "own subscriptions" on public.push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
