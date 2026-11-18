-- 공강메이트 F7 그룹·초대 링크 스키마 (Supabase SQL Editor에 그대로 붙여 넣어 실행)
--
-- groups 1 ── N members 1 ── N classes
-- 캡처 이미지는 저장하지 않고 이름과 수업 시간만 저장한다 (개인정보 요구사항).
-- 테이블은 RLS로 막아 두고, 서버(/api/group)가 secret 키(service_role 권한)로 아래 함수만 호출한다.

-- ---- 테이블 -----------------------------------------------------------------

create table if not exists groups (
  id          uuid primary key default gen_random_uuid(),   -- 초대 링크의 ?g= 값 (추측 불가)
  name        text not null default '공강 그룹'
              check (char_length(name) between 1 and 30),
  created_at  timestamptz not null default now()
);

create table if not exists members (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references groups(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 20),
  updated_at  timestamptz not null default now(),
  unique (group_id, name)                                   -- 그룹 안에서 표시 이름은 겹치지 않음
);

create table if not exists classes (
  id          bigint generated always as identity primary key,
  member_id   uuid not null references members(id) on delete cascade,
  day         text not null check (day in ('MON','TUE','WED','THU','FRI','SAT','SUN')),
  start_time  time not null,
  end_time    time not null,
  color       text,
  check (start_time < end_time)
);

create index if not exists members_group_idx on members(group_id);
create index if not exists classes_member_idx on classes(member_id);

alter table groups  enable row level security;   -- 정책을 만들지 않으므로 공개 키로는 접근 불가
alter table members enable row level security;
alter table classes enable row level security;

-- 테이블 권한: 서버 키(service_role)에만 준다.
-- 프로젝트 생성 때 "Grant API access to new tables automatically"를 끈 경우에도 동작하도록 직접 지정
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on groups, members, classes from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant usage on schema public to service_role;
    grant select, insert, update, delete on groups, members, classes to service_role;
    grant usage, select on all sequences in schema public to service_role;
  end if;
end;
$$;

-- ---- 함수 -------------------------------------------------------------------

-- 그룹 만들기 -> 그룹 ID
create or replace function create_group(p_name text default '공강 그룹')
returns uuid language sql as $$
  insert into groups(name) values (coalesce(nullif(trim(p_name), ''), '공강 그룹'))
  returning id;
$$;

-- 그룹 전체 조회: groups - members - classes JOIN (수업 한 줄 = 한 행)
create or replace function get_group(p_group uuid)
returns table (
  group_name   text,
  member_id    uuid,
  member_name  text,
  updated_at   timestamptz,
  day          text,
  start_time   text,
  end_time     text,
  color        text
) language sql stable as $$
  select g.name, m.id, m.name, m.updated_at, c.day,
         to_char(c.start_time, 'HH24:MI'), to_char(c.end_time, 'HH24:MI'), c.color
  from groups g
  left join members m on m.group_id = g.id
  left join classes c on c.member_id = m.id
  where g.id = p_group
  order by m.updated_at, m.name, c.day, c.start_time;
$$;

-- 멤버 저장 (한 트랜잭션): 추가 또는 수정 후 수업 목록 전체 교체 -> 멤버 ID
--   p_member 있음 : 그 멤버를 수정 (이름 변경 포함)
--   p_member 없음 : 같은 이름이 없으면 새로 추가
--                   같은 이름이 있으면 p_claim = true 일 때만 그 멤버를 덮어씀 ("내가 그 사람이에요")
create or replace function save_member(
  p_group   uuid,
  p_member  uuid,
  p_name    text,
  p_classes jsonb,
  p_claim   boolean default false
) returns uuid language plpgsql as $$
declare
  v_id       uuid;
  v_existing uuid;
begin
  if not exists (select 1 from groups where id = p_group) then
    raise exception 'GROUP_NOT_FOUND';
  end if;

  select id into v_existing from members where group_id = p_group and name = p_name;

  if p_member is not null then
    if not exists (select 1 from members where id = p_member and group_id = p_group) then
      raise exception 'MEMBER_NOT_FOUND';
    end if;
    if v_existing is not null and v_existing <> p_member then
      raise exception 'NAME_TAKEN';
    end if;
    v_id := p_member;
    update members set name = p_name, updated_at = now() where id = v_id;
  elsif v_existing is not null then
    if not p_claim then
      raise exception 'NAME_TAKEN';
    end if;
    v_id := v_existing;
    update members set updated_at = now() where id = v_id;
  else
    if (select count(*) from members where group_id = p_group) >= 20 then
      raise exception 'GROUP_FULL';
    end if;
    insert into members(group_id, name) values (p_group, p_name) returning id into v_id;
  end if;

  delete from classes where member_id = v_id;
  insert into classes(member_id, day, start_time, end_time, color)
  select v_id, x->>'day', (x->>'start')::time, (x->>'end')::time, x->>'color'
  from jsonb_array_elements(coalesce(p_classes, '[]'::jsonb)) as x;

  return v_id;
end;
$$;

-- 멤버 삭제 -> 삭제됐으면 true
create or replace function delete_member(p_group uuid, p_member uuid)
returns boolean language plpgsql as $$
begin
  delete from members where id = p_member and group_id = p_group;
  return found;
end;
$$;

-- 오래된 그룹 정리 (학기 단위 서비스: 기본 180일). 필요할 때 SQL Editor에서 실행
create or replace function delete_old_groups(p_days int default 180)
returns int language plpgsql as $$
declare
  v_count int;
begin
  delete from groups where created_at < now() - make_interval(days => p_days);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---- 권한: 공개 키(anon)로는 함수도 호출 불가, 서버의 service_role만 허용 ----------
do $$
declare
  f text;
begin
  foreach f in array array[
    'create_group(text)', 'get_group(uuid)', 'save_member(uuid,uuid,text,jsonb,boolean)',
    'delete_member(uuid,uuid)', 'delete_old_groups(int)'
  ] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon, authenticated', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
end;
$$;
