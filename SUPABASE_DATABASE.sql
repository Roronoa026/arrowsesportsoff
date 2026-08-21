-- ARROWS ESPORTS - Supabase database setup
-- Run this entire file once in Supabase > SQL Editor.

create table if not exists public.players (
  id text primary key,
  name text not null,
  efootball_id text not null default '',
  country text not null default '',
  photo text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.tournament_state (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.players enable row level security;
alter table public.tournament_state enable row level security;

-- Replace old policies with predictable policies for this frontend.
drop policy if exists "arrows players read" on public.players;
drop policy if exists "arrows players insert" on public.players;
drop policy if exists "arrows players update" on public.players;
drop policy if exists "arrows players delete" on public.players;
drop policy if exists "arrows tournament read" on public.tournament_state;
drop policy if exists "arrows tournament insert" on public.tournament_state;
drop policy if exists "arrows tournament update" on public.tournament_state;
drop policy if exists "arrows tournament delete" on public.tournament_state;

create policy "arrows players read"
on public.players for select to anon, authenticated
using (true);

create policy "arrows players insert"
on public.players for insert to anon, authenticated
with check (true);

create policy "arrows players update"
on public.players for update to anon, authenticated
using (true) with check (true);

create policy "arrows players delete"
on public.players for delete to anon, authenticated
using (true);

create policy "arrows tournament read"
on public.tournament_state for select to anon, authenticated
using (true);

create policy "arrows tournament insert"
on public.tournament_state for insert to anon, authenticated
with check (true);

create policy "arrows tournament update"
on public.tournament_state for update to anon, authenticated
using (true) with check (true);

create policy "arrows tournament delete"
on public.tournament_state for delete to anon, authenticated
using (true);

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.players to anon, authenticated;
grant select, insert, update, delete on public.tournament_state to anon, authenticated;

-- Create the single shared tournament record if it does not exist.
insert into public.tournament_state (id, data)
values ('main', '{}'::jsonb)
on conflict (id) do nothing;
