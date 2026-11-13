-- Run this once in the Supabase SQL editor (only needed for online accounts, friends and the leaderboard).
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  username_lower text generated always as (lower(username)) stored unique,
  data jsonb not null default '{}'::jsonb,
  mmr1 int not null default 0, w1 int not null default 0, l1 int not null default 0, placed1 boolean not null default false,
  mmr2 int not null default 0, w2 int not null default 0, l2 int not null default 0, placed2 boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "profiles readable" on public.profiles for select using (true);
create policy "profiles insert own" on public.profiles for insert to authenticated with check (auth.uid() = id);
create policy "profiles update own" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

create table if not exists public.friends (
  user_id uuid not null references public.profiles(id) on delete cascade,
  friend_id uuid not null references public.profiles(id) on delete cascade,
  primary key (user_id, friend_id)
);
alter table public.friends enable row level security;
create policy "friends select own" on public.friends for select to authenticated using (auth.uid() = user_id);
create policy "friends insert own" on public.friends for insert to authenticated with check (auth.uid() = user_id);
create policy "friends delete own" on public.friends for delete to authenticated using (auth.uid() = user_id);
