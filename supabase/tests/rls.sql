-- RLS checks for the history tables. Run in the Supabase SQL editor after the
-- migration. Everything is rolled back. Success ends with "RLS OK"; any failure
-- raises an exception naming the broken rule.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-000000000001', 'rls-a@test.local', '{"full_name":"Ana"}'),
  ('00000000-0000-4000-8000-000000000002', 'rls-b@test.local', '{"full_name":"Bruno"}'),
  ('00000000-0000-4000-8000-000000000003', 'rls-c@test.local', '{"full_name":"Carla"}');

-- Match 1: Ana and Bruno. Match 2: Carla only.
select public.record_match('{"game":"sueca","room_code":"RLS001","summary":{},"players":[
  {"seat":0,"name":"Ana","user_id":"00000000-0000-4000-8000-000000000001","team":"A","score":4,"won":true},
  {"seat":1,"name":"Bruno","user_id":"00000000-0000-4000-8000-000000000002","team":"B","score":1,"won":false},
  {"seat":2,"name":"Guest","team":"A","score":4,"won":true},
  {"seat":3,"name":"Bot","bot":true,"team":"B","score":1,"won":false}]}');
select public.record_match('{"game":"gringo","room_code":"RLS002","summary":{},"players":[
  {"seat":0,"name":"Carla","user_id":"00000000-0000-4000-8000-000000000003","score":3,"won":true},
  {"seat":1,"name":"Guest","score":20,"won":false}]}');

do $$ begin
  if (select count(*) from public.profiles where display_name = 'Ana') <> 1 then
    raise exception 'signup trigger did not create a profile';
  end if;
end $$;

-- Ana: sees match 1 and its 4 players, not match 2; only her own profile.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$ begin
  if (select count(*) from public.matches) <> 1 then raise exception 'Ana should see exactly 1 match'; end if;
  if (select count(*) from public.match_players) <> 4 then raise exception 'Ana should see 4 players of her match'; end if;
  if exists (select 1 from public.matches where room_code = 'RLS002') then raise exception 'Ana sees a match she did not play'; end if;
  if (select count(*) from public.profiles) <> 1 then raise exception 'Ana should see only her own profile'; end if;
end $$;

-- Writes are refused for signed-in users.
do $$ begin
  begin
    insert into public.matches (game, room_code) values ('sueca', 'HACK01');
    raise exception 'authenticated could insert into matches';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.match_players set won = true;
    raise exception 'authenticated could update match_players';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.record_match('{"game":"sueca","room_code":"HACK02","players":[]}');
    raise exception 'authenticated could call record_match';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Carla: only match 2.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000003","role":"authenticated"}';
do $$ begin
  if (select count(*) from public.matches) <> 1 or not exists (select 1 from public.matches where room_code = 'RLS002') then
    raise exception 'Carla should see only match 2';
  end if;
end $$;

-- Anonymous: nothing.
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$ begin
  if (select count(*) from public.matches) <> 0 then raise exception 'anon sees matches'; end if;
  if (select count(*) from public.match_players) <> 0 then raise exception 'anon sees match_players'; end if;
  if (select count(*) from public.profiles) <> 0 then raise exception 'anon sees profiles'; end if;
end $$;

reset role;
select 'RLS OK' as result;

rollback;
