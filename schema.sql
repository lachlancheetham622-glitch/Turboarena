-- Run this once in Supabase: SQL Editor -> New query -> paste -> Run.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  username_lower text generated always as (lower(username)) stored unique,
  data jsonb not null default '{}'::jsonb,
  mmr1 int default 0, w1 int default 0, l1 int default 0, placed1 boolean default false,
  mmr2 int default 0, w2 int default 0, l2 int default 0, placed2 boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.friends (
  user_id uuid not null references public.profiles(id) on delete cascade,
  friend_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (user_id, friend_id)
);

create index if not exists profiles_mmr1_idx on public.profiles (mmr1 desc) where placed1;
create index if not exists profiles_mmr2_idx on public.profiles (mmr2 desc) where placed2;

alter table public.profiles enable row level security;
alter table public.friends enable row level security;

drop policy if exists "profiles readable by all" on public.profiles;
create policy "profiles readable by all" on public.profiles for select using (true);
drop policy if exists "insert own profile" on public.profiles;
create policy "insert own profile" on public.profiles for insert with check (auth.uid() = id);
drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles for update using (auth.uid() = id);

drop policy if exists "read own friends" on public.friends;
create policy "read own friends" on public.friends for select using (auth.uid() = user_id);
drop policy if exists "add own friends" on public.friends;
create policy "add own friends" on public.friends for insert with check (auth.uid() = user_id);
drop policy if exists "remove own friends" on public.friends;
create policy "remove own friends" on public.friends for delete using (auth.uid() = user_id);
