-- ARROWS ESPORTS - Supabase relational database setup
-- Run this file in Supabase > SQL Editor.
-- This schema matches supabase-data.js.

create extension if not exists pgcrypto;

create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null default 'roundrobin',
  description text not null default '',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  logo text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  efootball_id text not null default '',
  country text not null default '',
  photo text not null default '',
  team_id uuid references public.teams(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Upgrade an older players table created by a previous version of this project.
alter table public.players add column if not exists efootball_id text not null default '';
alter table public.players add column if not exists country text not null default '';
alter table public.players add column if not exists photo text not null default '';
alter table public.players add column if not exists team_id uuid references public.teams(id) on delete set null;
alter table public.players add column if not exists created_at timestamptz not null default now();

create table if not exists public.tournament_teams (
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  primary key (tournament_id, team_id)
);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  home_team_id uuid not null references public.teams(id) on delete cascade,
  away_team_id uuid not null references public.teams(id) on delete cascade,
  home_score integer not null default 0,
  away_score integer not null default 0,
  match_date timestamptz,
  round integer not null default 1,
  status text not null default 'scheduled',
  venue text not null default '',
  stage text not null default 'League',
  group_name text not null default '',
  home_goalkeeper_id uuid references public.players(id) on delete set null,
  away_goalkeeper_id uuid references public.players(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.match_goals (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  player_id uuid references public.players(id) on delete set null,
  team_id uuid references public.teams(id) on delete set null,
  minute integer,
  created_at timestamptz not null default now()
);

create table if not exists public.awards (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  match_id uuid references public.matches(id) on delete cascade,
  player_id uuid references public.players(id) on delete set null,
  award_type text not null,
  title text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_players_team on public.players(team_id);
create index if not exists idx_matches_tournament on public.matches(tournament_id);
create index if not exists idx_match_goals_match on public.match_goals(match_id);
create index if not exists idx_awards_tournament on public.awards(tournament_id);

alter table public.tournaments enable row level security;
alter table public.teams enable row level security;
alter table public.players enable row level security;
alter table public.tournament_teams enable row level security;
alter table public.matches enable row level security;
alter table public.match_goals enable row level security;
alter table public.awards enable row level security;

-- The current static frontend uses the Supabase publishable/anon key directly.
-- These policies preserve that behavior. For a production admin system,
-- replace write policies with authenticated/admin-only policies.
do $$
declare
  tbl text;
  pol text;
begin
  foreach tbl in array array['tournaments','teams','players','tournament_teams','matches','match_goals','awards'] loop
    foreach pol in array array['read','insert','update','delete'] loop
      execute format('drop policy if exists %I on public.%I', 'arrows ' || tbl || ' ' || pol, tbl);
    end loop;
    execute format('create policy %I on public.%I for select to anon, authenticated using (true)', 'arrows ' || tbl || ' read', tbl);
    execute format('create policy %I on public.%I for insert to anon, authenticated with check (true)', 'arrows ' || tbl || ' insert', tbl);
    execute format('create policy %I on public.%I for update to anon, authenticated using (true) with check (true)', 'arrows ' || tbl || ' update', tbl);
    execute format('create policy %I on public.%I for delete to anon, authenticated using (true)', 'arrows ' || tbl || ' delete', tbl);
  end loop;
end $$;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.tournaments, public.teams, public.players,
  public.tournament_teams, public.matches, public.match_goals, public.awards to anon, authenticated;
