-- Run the entire file MANUALLY in pgAdmin Query Tool, connected to kynetis_local as postgres.
-- No Docker startup command executes this script. Existing public.customers is untouched.
BEGIN;
CREATE SCHEMA IF NOT EXISTS kynetis;
REVOKE ALL ON SCHEMA kynetis FROM PUBLIC;
CREATE TABLE IF NOT EXISTS kynetis.users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 email text NOT NULL UNIQUE CHECK(email=lower(trim(email)) AND length(email)<=254),
 password_hash text NOT NULL,
 metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS kynetis.sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES kynetis.users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON kynetis.sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON kynetis.sessions(expires_at);
CREATE TABLE IF NOT EXISTS kynetis.auth_attempts (
 key text PRIMARY KEY, attempts integer NOT NULL DEFAULT 1,
 expires_at timestamptz NOT NULL DEFAULT (now()+interval '15 minutes')
);
CREATE TABLE IF NOT EXISTS kynetis.reset_tokens (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES kynetis.users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS resets_user_idx ON kynetis.reset_tokens(user_id);
create table if not exists kynetis.workspaces (
  id uuid primary key, owner_id uuid not null references kynetis.users(id) on delete restrict,
  state jsonb not null, revision bigint not null default 0 check (revision >= 0),
  created_at timestamptz not null default now()
);
create table if not exists kynetis.memberships (
  user_id uuid primary key references kynetis.users(id) on delete cascade,
  workspace_id uuid not null references kynetis.workspaces(id) on delete restrict,
  role text not null default 'customer' check (role in ('customer','compliance_officer','admin'))
);
create table if not exists kynetis.events (
  id uuid primary key, workspace_id uuid not null references kynetis.workspaces(id),
  revision bigint not null, operation text not null, actor text not null,
  actor_user_id uuid not null references kynetis.users(id), created_at timestamptz not null,
  payload jsonb not null, previous_hash text not null, digest text not null,
  unique(workspace_id,revision)
);
create table if not exists kynetis.uploads (
  id uuid primary key, workspace_id uuid not null references kynetis.workspaces(id),
  user_id uuid not null references kynetis.users(id), revision bigint not null,
  document jsonb not null, expires_at timestamptz not null default (now()+interval '10 minutes'),
  completed boolean not null default false
);
create table if not exists kynetis.portal_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references kynetis.users(id) on delete cascade,
  workspace_id uuid not null references kynetis.workspaces(id) on delete restrict,
  role text not null check (role in ('compliance_officer','admin')),
  label text not null check (length(label) between 1 and 120),
  reason text not null check (length(reason) between 10 and 500),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  unique(user_id,workspace_id,role),
  check (expires_at is null or expires_at>created_at)
);
create index if not exists kynetis_portal_grants_workspace_idx on kynetis.portal_grants(workspace_id);
create or replace function kynetis.bootstrap(p_user uuid,p_state jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare m kynetis.memberships; w kynetis.workspaces;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
  select * into m from kynetis.memberships where user_id=p_user;
  if not found then
    insert into kynetis.workspaces(id,owner_id,state) values(p_user,p_user,p_state) on conflict(id) do nothing;
    insert into kynetis.memberships(user_id,workspace_id,role) values(p_user,p_user,'customer') returning * into m;
  end if;
  select * into strict w from kynetis.workspaces where id=m.workspace_id;
  return jsonb_build_object('workspace',w.id,'role',m.role,'portals',
    jsonb_build_array(jsonb_build_object('id','primary','workspace',w.id,'role',m.role,
      'label',case m.role when 'customer' then 'Personal workspace' when 'compliance_officer' then 'Institution workspace' else 'Administration' end))
    || coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'workspace',g.workspace_id,'role',g.role,'label',g.label) order by g.created_at)
      from kynetis.portal_grants g where g.user_id=p_user and g.revoked_at is null and (g.expires_at is null or g.expires_at>now())), '[]'::jsonb));
end $$;

create or replace function kynetis.commit(
  p_workspace uuid,p_revision bigint,p_state jsonb,p_event jsonb,p_user uuid,p_upload uuid default null
) returns void language plpgsql security invoker set search_path='' as $$
declare w kynetis.workspaces; previous text; ticket kynetis.uploads;
begin
  if not exists(select 1 from kynetis.memberships where user_id=p_user and workspace_id=p_workspace)
    and not exists(select 1 from kynetis.portal_grants where user_id=p_user and workspace_id=p_workspace
      and revoked_at is null and (expires_at is null or expires_at>now())) then
    raise exception 'Workspace access denied' using errcode='42501';
  end if;
  select * into strict w from kynetis.workspaces where id=p_workspace for update;
  if w.revision<>p_revision then raise exception 'Workspace changed' using errcode='40001'; end if;
  select digest into previous from kynetis.events where workspace_id=p_workspace order by revision desc limit 1;
  if coalesce(previous,'GENESIS')<>p_event->>'previous_hash' then raise exception 'Audit chain changed' using errcode='40001'; end if;
  if p_upload is not null then
    select * into ticket from kynetis.uploads where id=p_upload for update;
    if not found or ticket.workspace_id<>p_workspace or ticket.user_id<>p_user or ticket.revision<>p_revision or ticket.completed or ticket.expires_at<now() then
      raise exception 'Upload expired or consumed' using errcode='40001';
    end if;
    update kynetis.uploads set completed=true where id=p_upload;
  end if;
  update kynetis.workspaces set state=p_state,revision=p_revision+1 where id=p_workspace;
  insert into kynetis.events(id,workspace_id,revision,operation,actor,actor_user_id,created_at,payload,previous_hash,digest)
  values((p_event->>'id')::uuid,p_workspace,p_revision+1,p_event->>'operation',p_event->>'actor',p_user,(p_event->>'created_at')::timestamptz,p_event->'payload',p_event->>'previous_hash',p_event->>'digest');
end $$;

REVOKE ALL ON ALL TABLES IN SCHEMA kynetis FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA kynetis FROM PUBLIC;
GRANT USAGE ON SCHEMA kynetis TO app_user;
GRANT SELECT,INSERT,UPDATE ON kynetis.users,kynetis.workspaces TO app_user;
GRANT SELECT,INSERT ON kynetis.memberships,kynetis.events TO app_user;
GRANT SELECT ON kynetis.portal_grants TO app_user;
GRANT SELECT,INSERT,UPDATE,DELETE ON kynetis.sessions,kynetis.auth_attempts,kynetis.reset_tokens,kynetis.uploads TO app_user;
GRANT EXECUTE ON FUNCTION kynetis.bootstrap(uuid,jsonb),kynetis.commit(uuid,bigint,jsonb,jsonb,uuid,uuid) TO app_user;
COMMIT;
