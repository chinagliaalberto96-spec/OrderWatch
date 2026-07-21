create table if not exists public.mailbox_management_audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_app_user_id uuid references public.app_users(id) on delete set null,
  actor_membership_id uuid references public.organization_memberships(id) on delete set null,
  mailbox_id uuid references public.mailboxes(id) on delete set null,
  action text not null check (action in ('connect', 'test', 'disconnect')),
  outcome text not null check (outcome in ('attempted', 'succeeded', 'failed', 'rejected', 'not_found')),
  request_method text not null,
  request_path text not null,
  request_ip_hash text,
  user_agent text,
  deployment_id text,
  target_email_hash text,
  created_at timestamptz not null default now()
);

alter table public.mailbox_management_audit_logs enable row level security;

revoke all on table public.mailbox_management_audit_logs from anon, authenticated;

create index if not exists mailbox_management_audit_org_created_idx
  on public.mailbox_management_audit_logs (organization_id, created_at desc);

create index if not exists mailbox_management_audit_mailbox_created_idx
  on public.mailbox_management_audit_logs (mailbox_id, created_at desc)
  where mailbox_id is not null;

create index if not exists mailbox_management_audit_actor_created_idx
  on public.mailbox_management_audit_logs (actor_app_user_id, created_at desc)
  where actor_app_user_id is not null;

comment on table public.mailbox_management_audit_logs is
  'Registro append-only delle operazioni di gestione mailbox; accessibile soltanto dal backend service-role.';
