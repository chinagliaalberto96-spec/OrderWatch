-- ContractWatch foundation on top of the shared projects identity.
-- Existing OrderWatch projects remain unchanged because all new module fields
-- are nullable or disabled by default.

alter table public.projects
  add column if not exists name text,
  add column if not exists description text,
  add column if not exists start_date date,
  add column if not exists expected_end_date date,
  add column if not exists contract_status text,
  add column if not exists contract_watch_enabled boolean not null default false,
  add column if not exists responsible_membership_id uuid,
  add column if not exists created_by_membership_id uuid,
  add column if not exists archived_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'projects_contract_status_check'
      and conrelid = 'public.projects'::regclass
  ) then
    alter table public.projects
      add constraint projects_contract_status_check
      check (
        contract_status is null
        or contract_status in ('draft', 'active', 'suspended', 'completed', 'archived')
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'projects_contract_dates_check'
      and conrelid = 'public.projects'::regclass
  ) then
    alter table public.projects
      add constraint projects_contract_dates_check
      check (
        start_date is null
        or expected_end_date is null
        or expected_end_date >= start_date
      );
  end if;
end $$;

create unique index if not exists projects_org_id_key
  on public.projects(organization_id, id);

create unique index if not exists organization_memberships_org_id_key
  on public.organization_memberships(organization_id, id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'projects_responsible_membership_tenant_fkey'
      and conrelid = 'public.projects'::regclass
  ) then
    alter table public.projects
      add constraint projects_responsible_membership_tenant_fkey
      foreign key (organization_id, responsible_membership_id)
      references public.organization_memberships(organization_id, id)
      on delete restrict;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'projects_created_by_membership_tenant_fkey'
      and conrelid = 'public.projects'::regclass
  ) then
    alter table public.projects
      add constraint projects_created_by_membership_tenant_fkey
      foreign key (organization_id, created_by_membership_id)
      references public.organization_memberships(organization_id, id)
      on delete restrict;
  end if;
end $$;

create index if not exists idx_projects_contract_watch_list
  on public.projects(organization_id, contract_status, expected_end_date, created_at desc)
  where contract_watch_enabled = true;

create index if not exists idx_projects_responsible_membership
  on public.projects(organization_id, responsible_membership_id)
  where responsible_membership_id is not null;

insert into public.settings (
  organization_id,
  key,
  value,
  type,
  "group",
  description,
  customer_visible,
  status
)
select
  organization.id,
  'modules.contract_watch',
  'false',
  'boolean',
  'modules',
  'Abilita il modulo ContractWatch per questa organizzazione',
  false,
  'active'
from public.organizations organization
on conflict (organization_id, key) do nothing;

alter table public.projects enable row level security;

-- The current architecture accesses product tables only from trusted server
-- code using service_role. Keep direct client access denied: no anon or
-- authenticated policies are introduced by this migration.
revoke all on table public.projects from anon, authenticated;
grant select, insert, update, delete on table public.projects to service_role;
