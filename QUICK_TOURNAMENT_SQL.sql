-- ARROWS ESPORTS — Quick Tournament migration
-- Run this once in Supabase > SQL Editor before using the Quick Tournament admin page.

create table if not exists public.quick_tournament_state (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.quick_tournament_state enable row level security;

drop policy if exists "arrows quick tournament read" on public.quick_tournament_state;
drop policy if exists "arrows quick tournament insert" on public.quick_tournament_state;
drop policy if exists "arrows quick tournament update" on public.quick_tournament_state;
drop policy if exists "arrows quick tournament delete" on public.quick_tournament_state;

create policy "arrows quick tournament read"
on public.quick_tournament_state for select to anon, authenticated
using (true);

create policy "arrows quick tournament insert"
on public.quick_tournament_state for insert to anon, authenticated
with check (true);

create policy "arrows quick tournament update"
on public.quick_tournament_state for update to anon, authenticated
using (true) with check (true);

create policy "arrows quick tournament delete"
on public.quick_tournament_state for delete to anon, authenticated
using (true);

grant select, insert, update, delete on public.quick_tournament_state to anon, authenticated;

insert into public.quick_tournament_state (id, data)
values (
  'main',
  '{"version":1,"title":"ARROWS QUICK TOURNAMENT","size":8,"status":"upcoming","players":[],"fixtures":[]}'::jsonb
)
on conflict (id) do nothing;
