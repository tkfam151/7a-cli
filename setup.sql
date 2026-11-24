-- ============================================================
--  SISB 7A Classroom: database setup for Supabase
--  Paste this whole file into Supabase → SQL Editor → Run.
--  Safe to run again later; it won't delete accounts or posts.
-- ============================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- tables (locked: the website only uses the functions below) ----------
create table if not exists public.accounts (
  username      text primary key,
  display_name  text not null,
  password_hash text,                       -- null = password not set yet
  role          text not null check (role in ('admin', 'creator', 'student')),
  created_by    text,
  created_at    timestamptz not null default now()
);

create table if not exists public.sessions (
  token      uuid primary key default gen_random_uuid(),
  username   text not null references public.accounts(username) on delete cascade,
  expires_at timestamptz not null default now() + interval '30 days'
);

create table if not exists public.announcements (
  id         bigint generated always as identity primary key,
  body       text not null check (length(body) between 1 and 5000),
  author     text references public.accounts(username) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.comments (
  id              bigint generated always as identity primary key,
  announcement_id bigint not null references public.announcements(id) on delete cascade,
  body            text not null check (length(body) between 1 and 1000),
  author          text references public.accounts(username) on delete cascade,
  created_at      timestamptz not null default now()
);

alter table public.accounts      enable row level security;
alter table public.sessions      enable row level security;
alter table public.announcements enable row level security;
alter table public.comments      enable row level security;
revoke all on public.accounts, public.sessions, public.announcements, public.comments from anon, authenticated;

-- ---------- built-in accounts ----------
-- Teacher/admin: password is chosen on the website the first time.
insert into public.accounts (username, display_name, role)
values ('tonkla', 'Tonkla', 'admin')
on conflict (username) do nothing;

-- Shared sign-up login: can ONLY create student accounts.
insert into public.accounts (username, display_name, role, password_hash)
values ('sisb', 'Sign-up', 'creator', extensions.crypt('sisb7a', extensions.gen_salt('bf')))
on conflict (username) do nothing;

-- ---------- helpers ----------
create or replace function public._me(p_token uuid)
returns public.accounts
language plpgsql security definer set search_path = public, extensions as $$
declare a public.accounts;
begin
  select acc.* into a
  from public.sessions s join public.accounts acc on acc.username = s.username
  where s.token = p_token and s.expires_at > now();
  if a.username is null then
    raise exception 'Please log in again.' using errcode = 'P0001';
  end if;
  return a;
end $$;

create or replace function public._session_json(a public.accounts)
returns json
language plpgsql security definer set search_path = public, extensions as $$
declare t uuid;
begin
  delete from public.sessions where expires_at < now();
  insert into public.sessions (username) values (a.username) returning token into t;
  return json_build_object('token', t, 'username', a.username, 'display_name', a.display_name, 'role', a.role);
end $$;

-- ---------- login ----------
create or replace function public.admin_needs_setup()
returns boolean
language sql security definer set search_path = public, extensions as $$
  select exists (select 1 from public.accounts where username = 'tonkla' and password_hash is null);
$$;

create or replace function public.admin_setup(p_password text)
returns json
language plpgsql security definer set search_path = public, extensions as $$
declare a public.accounts;
begin
  if length(coalesce(p_password, '')) < 4 then
    raise exception 'Password must be at least 4 characters.' using errcode = 'P0001';
  end if;
  update public.accounts set password_hash = crypt(p_password, gen_salt('bf'))
  where username = 'tonkla' and password_hash is null
  returning * into a;
  if a.username is null then
    raise exception 'The teacher password is already set.' using errcode = 'P0001';
  end if;
  return public._session_json(a);
end $$;

create or replace function public.login(p_username text, p_password text)
returns json
language plpgsql security definer set search_path = public, extensions as $$
declare a public.accounts;
begin
  select * into a from public.accounts where username = lower(trim(p_username));
  if a.username is null or a.password_hash is null
     or a.password_hash <> crypt(coalesce(p_password, ''), a.password_hash) then
    perform pg_sleep(0.5);
    raise exception 'Wrong username or password.' using errcode = 'P0001';
  end if;
  return public._session_json(a);
end $$;

create or replace function public.logout(p_token uuid)
returns void
language sql security definer set search_path = public, extensions as $$
  delete from public.sessions where token = p_token;
$$;

-- ---------- accounts ----------
create or replace function public.create_account(p_token uuid, p_username text, p_display_name text, p_password text, p_role text default 'student')
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare me public.accounts; u text := lower(trim(p_username)); r text := coalesce(p_role, 'student');
begin
  me := public._me(p_token);
  if me.role not in ('admin', 'creator') then
    raise exception 'You are not allowed to create accounts.' using errcode = 'P0001';
  end if;
  if me.role <> 'admin' then r := 'student'; end if;
  if r not in ('admin', 'student') then
    raise exception 'Unknown account type.' using errcode = 'P0001';
  end if;
  if u !~ '^[a-z0-9._-]{3,30}$' then
    raise exception 'Username must be 3-30 characters: letters, numbers, dot, dash or underscore (no spaces).' using errcode = 'P0001';
  end if;
  if length(trim(coalesce(p_display_name, ''))) = 0 or length(trim(p_display_name)) > 60 then
    raise exception 'Please type a name (60 characters max).' using errcode = 'P0001';
  end if;
  if length(coalesce(p_password, '')) < 4 then
    raise exception 'Password must be at least 4 characters.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.accounts where username = u) then
    raise exception 'The username "%" is already taken.', u using errcode = 'P0001';
  end if;
  insert into public.accounts (username, display_name, password_hash, role, created_by)
  values (u, trim(p_display_name), crypt(p_password, gen_salt('bf')), r, me.username);
end $$;

create or replace function public.list_accounts(p_token uuid)
returns json
language plpgsql security definer set search_path = public, extensions as $$
declare me public.accounts;
begin
  me := public._me(p_token);
  if me.role <> 'admin' then raise exception 'Teachers only.' using errcode = 'P0001'; end if;
  return coalesce((
    select json_agg(json_build_object('username', username, 'display_name', display_name, 'role', role, 'created_at', created_at)
                    order by role, display_name)
    from public.accounts
  ), '[]'::json);
end $$;

create or replace function public.delete_account(p_token uuid, p_username text)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare me public.accounts;
begin
  me := public._me(p_token);
  if me.role <> 'admin' then raise exception 'Teachers only.' using errcode = 'P0001'; end if;
  if p_username in ('tonkla', 'sisb') or p_username = me.username then
    raise exception 'That account can''t be deleted.' using errcode = 'P0001';
  end if;
  delete from public.accounts where username = p_username;
end $$;

create or replace function public.reset_password(p_token uuid, p_username text, p_password text)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare me public.accounts;
begin
  me := public._me(p_token);
  if me.role <> 'admin' then raise exception 'Teachers only.' using errcode = 'P0001'; end if;
  if length(coalesce(p_password, '')) < 4 then
    raise exception 'Password must be at least 4 characters.' using errcode = 'P0001';
  end if;
  update public.accounts set password_hash = crypt(p_password, gen_salt('bf')) where username = p_username;
  delete from public.sessions where username = p_username;
end $$;

-- ---------- announcements ----------
create or replace function public.get_stream(p_token uuid)
returns json
language plpgsql security definer set search_path = public, extensions as $$
declare me public.accounts;
begin
  me := public._me(p_token);
  if me.role = 'creator' then raise exception 'This login can only create accounts.' using errcode = 'P0001'; end if;
  return coalesce((
    select json_agg(json_build_object(
      'id', a.id, 'body', a.body, 'created_at', a.created_at,
      'author', coalesce(acc.display_name, 'Teacher'),
      'comments', coalesce((
        select json_agg(json_build_object('id', c.id, 'body', c.body, 'created_at', c.created_at,
                                          'author', cacc.display_name, 'mine', c.author = me.username)
                        order by c.created_at)
        from public.comments c left join public.accounts cacc on cacc.username = c.author
        where c.announcement_id = a.id), '[]'::json)
    ) order by a.created_at desc)
    from public.announcements a left join public.accounts acc on acc.username = a.author
  ), '[]'::json);
end $$;

create or replace function public.post_announcement(p_token uuid, p_body text)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare me public.accounts;
begin
  me := public._me(p_token);
  if me.role <> 'admin' then raise exception 'Only teachers can post announcements.' using errcode = 'P0001'; end if;
  if length(trim(coalesce(p_body, ''))) = 0 then raise exception 'Write something first.' using errcode = 'P0001'; end if;
  insert into public.announcements (body, author) values (trim(p_body), me.username);
end $$;

create or replace function public.delete_announcement(p_token uuid, p_id bigint)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare me public.accounts;
begin
  me := public._me(p_token);
  if me.role <> 'admin' then raise exception 'Teachers only.' using errcode = 'P0001'; end if;
  delete from public.announcements where id = p_id;
end $$;

create or replace function public.add_comment(p_token uuid, p_announcement_id bigint, p_body text)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare me public.accounts;
begin
  me := public._me(p_token);
  if me.role = 'creator' then raise exception 'This login can only create accounts.' using errcode = 'P0001'; end if;
  if length(trim(coalesce(p_body, ''))) = 0 then raise exception 'Write something first.' using errcode = 'P0001'; end if;
  if length(trim(p_body)) > 1000 then raise exception 'Comment is too long.' using errcode = 'P0001'; end if;
  insert into public.comments (announcement_id, body, author) values (p_announcement_id, trim(p_body), me.username);
end $$;

create or replace function public.delete_comment(p_token uuid, p_id bigint)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare me public.accounts;
begin
  me := public._me(p_token);
  delete from public.comments where id = p_id and (author = me.username or me.role = 'admin');
end $$;

-- ---------- permissions: the website may call these functions, nothing else ----------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.admin_needs_setup(), public.admin_setup(text), public.login(text, text), public.logout(uuid),
  public.create_account(uuid, text, text, text, text), public.list_accounts(uuid),
  public.delete_account(uuid, text), public.reset_password(uuid, text, text),
  public.get_stream(uuid), public.post_announcement(uuid, text), public.delete_announcement(uuid, bigint),
  public.add_comment(uuid, bigint, text), public.delete_comment(uuid, bigint)
to anon;
