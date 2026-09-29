-- Phase 3: profiles and match history.
-- Clients only read their own rows. Only the game server (secret key) writes,
-- through record_match().

-- ---------- profiles ----------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  avatar_url text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles: read own" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Only the trigger runs it; it must not be callable through the API.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Users who signed in before this migration.
insert into public.profiles (id, display_name, avatar_url)
select id,
       coalesce(raw_user_meta_data ->> 'full_name', raw_user_meta_data ->> 'name', ''),
       raw_user_meta_data ->> 'avatar_url'
from auth.users
on conflict (id) do nothing;

-- ---------- history ----------

-- One row per finished Sueca match or finished Gringo round.
create table public.matches (
  id uuid primary key default gen_random_uuid(),
  game text not null check (game in ('sueca', 'gringo')),
  room_code text not null,
  played_at timestamptz not null default now(),
  summary jsonb not null default '{}'
);

create table public.match_players (
  match_id uuid not null references public.matches (id) on delete cascade,
  seat smallint not null,
  name text not null,
  -- Null for guests and bots.
  user_id uuid references public.profiles (id) on delete set null,
  bot boolean not null default false,
  -- Sueca team; null in Gringo.
  team text check (team in ('A', 'B')),
  -- Sueca: team riscos. Gringo: card total (lower is better).
  score integer not null,
  won boolean not null,
  primary key (match_id, seat)
);

create index match_players_user_id_idx on public.match_players (user_id);
create index matches_played_at_idx on public.matches (played_at desc);

alter table public.matches enable row level security;
alter table public.match_players enable row level security;

-- Security definer so the policies below do not recurse into match_players RLS.
create function public.is_match_player(m uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.match_players
    where match_id = m and user_id = (select auth.uid())
  );
$$;

create policy "matches: read own" on public.matches
  for select to authenticated
  using (public.is_match_player(id));

-- Everyone at a table I played at, so history can show the other names.
create policy "match_players: read own matches" on public.match_players
  for select to authenticated
  using (public.is_match_player(match_id));

revoke insert, update, delete on public.profiles, public.matches, public.match_players from anon, authenticated;

-- ---------- writes (game server only) ----------

-- p: { game, room_code, summary, players: [{ seat, name, user_id, bot, team, score, won }] }
create function public.record_match(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid;
begin
  insert into public.matches (game, room_code, summary)
  values (p ->> 'game', p ->> 'room_code', coalesce(p -> 'summary', '{}'))
  returning id into new_id;

  insert into public.match_players (match_id, seat, name, user_id, bot, team, score, won)
  select new_id, x.seat, x.name, x.user_id, coalesce(x.bot, false), x.team, x.score, x.won
  from jsonb_to_recordset(p -> 'players')
    as x(seat smallint, name text, user_id uuid, bot boolean, team text, score integer, won boolean);

  return new_id;
end;
$$;

revoke execute on function public.record_match(jsonb) from public, anon, authenticated;
grant execute on function public.record_match(jsonb) to service_role;
revoke execute on function public.is_match_player(uuid) from public, anon;
grant execute on function public.is_match_player(uuid) to authenticated;
