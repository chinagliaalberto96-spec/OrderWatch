-- ContractWatch foundation hardening.
-- Only rows already marked as ContractWatch are normalized. Existing
-- OrderWatch-only projects remain untouched.

update public.projects
set contract_status = 'draft'
where contract_watch_enabled = true
  and contract_status is null;

-- `archived` was initially used as a contract status. Preserve the archival
-- information while converting that legacy value to an operational status.
-- The generic project status is deliberately left unchanged.
update public.projects
set
  archived_at = coalesce(archived_at, updated_at, now()),
  contract_status = 'completed'
where contract_watch_enabled = true
  and contract_status = 'archived';

alter table public.projects
  drop constraint if exists projects_contract_status_check;

alter table public.projects
  add constraint projects_contract_status_check
  check (
    contract_status is null
    or contract_status in ('draft', 'active', 'suspended', 'completed')
  );

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'projects_contract_watch_status_required_check'
      and conrelid = 'public.projects'::regclass
  ) then
    alter table public.projects
      add constraint projects_contract_watch_status_required_check
      check (contract_watch_enabled = false or contract_status is not null);
  end if;
end $$;

alter table public.activities
  add column if not exists entity_type text,
  add column if not exists entity_id uuid,
  add column if not exists action text,
  add column if not exists actor_membership_id uuid,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'activities_actor_membership_tenant_fkey'
      and conrelid = 'public.activities'::regclass
  ) then
    alter table public.activities
      add constraint activities_actor_membership_tenant_fkey
      foreign key (organization_id, actor_membership_id)
      references public.organization_memberships(organization_id, id)
      on delete restrict;
  end if;
end $$;

create index if not exists idx_activities_entity_timeline
  on public.activities(organization_id, entity_type, entity_id, date desc)
  where entity_id is not null;

create index if not exists idx_activities_actor_membership
  on public.activities(organization_id, actor_membership_id)
  where actor_membership_id is not null;
