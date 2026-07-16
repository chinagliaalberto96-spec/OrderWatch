-- ContractWatch vertical slice: commessa -> SAL -> voce da fatturare -> Oggi.
-- buyer_actions remains untouched because its model is procurement-specific.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists public.operational_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  action_type text not null,
  status text not null default 'open'
    check (status in ('open', 'done', 'cancelled')),
  title text not null,
  detail text,
  entity_type text not null,
  entity_id uuid not null,
  project_id uuid,
  due_date date,
  assigned_membership_id uuid,
  created_by_membership_id uuid not null,
  completed_at timestamptz,
  deduplication_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (btrim(action_type) <> ''),
  check (btrim(entity_type) <> ''),
  check (deduplication_key is null or btrim(deduplication_key) <> '')
);

create unique index if not exists operational_actions_org_id_key
  on public.operational_actions(organization_id, id);

create unique index if not exists operational_actions_org_deduplication_key
  on public.operational_actions(organization_id, deduplication_key)
  where deduplication_key is not null;

create index if not exists idx_operational_actions_open_queue
  on public.operational_actions(organization_id, due_date, created_at desc)
  where status = 'open';

create index if not exists idx_operational_actions_project
  on public.operational_actions(organization_id, project_id)
  where project_id is not null;

create index if not exists idx_operational_actions_assignee
  on public.operational_actions(organization_id, assigned_membership_id)
  where assigned_membership_id is not null;

create table if not exists public.contract_progress_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  sal_number text not null,
  title text not null,
  period_start date,
  period_end date,
  progress_percentage numeric(5,2),
  amount numeric(14,2) not null,
  currency text not null default 'EUR',
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'approved', 'rejected', 'cancelled')),
  submitted_at timestamptz,
  approved_at timestamptz,
  rejection_reason text,
  external_reference text,
  created_by_membership_id uuid not null,
  submitted_by_membership_id uuid,
  approved_by_membership_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (btrim(sal_number) <> ''),
  check (btrim(title) <> ''),
  check (amount >= 0),
  check (progress_percentage is null or progress_percentage between 0 and 100),
  check (period_start is null or period_end is null or period_end >= period_start),
  check (currency ~ '^[A-Z]{3}$')
);

create unique index if not exists contract_progress_reports_org_id_key
  on public.contract_progress_reports(organization_id, id);

create unique index if not exists contract_progress_reports_org_id_project_key
  on public.contract_progress_reports(organization_id, id, project_id);

create unique index if not exists contract_progress_reports_number_key
  on public.contract_progress_reports(organization_id, project_id, sal_number);

create index if not exists idx_contract_progress_reports_project
  on public.contract_progress_reports(organization_id, project_id, created_at desc);

create index if not exists idx_contract_progress_reports_status
  on public.contract_progress_reports(organization_id, status, updated_at desc);

create table if not exists public.contract_billing_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  progress_report_id uuid not null,
  amount numeric(14,2) not null,
  currency text not null default 'EUR',
  target_date date,
  status text not null default 'to_issue'
    check (status in ('to_issue', 'issued', 'cancelled')),
  issued_at timestamptz,
  invoice_reference text,
  action_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (amount >= 0),
  check (currency ~ '^[A-Z]{3}$'),
  check (
    (status = 'issued' and issued_at is not null and nullif(btrim(invoice_reference), '') is not null)
    or (status <> 'issued')
  )
);

create unique index if not exists contract_billing_items_org_id_key
  on public.contract_billing_items(organization_id, id);

-- Only one active item per SAL. Issued/cancelled history does not prevent a
-- future extension that deliberately creates another billing item.
create unique index if not exists contract_billing_items_one_active_per_sal
  on public.contract_billing_items(organization_id, progress_report_id)
  where status = 'to_issue';

create index if not exists idx_contract_billing_items_project
  on public.contract_billing_items(organization_id, project_id, created_at desc);

create index if not exists idx_contract_billing_items_open_queue
  on public.contract_billing_items(organization_id, target_date, created_at desc)
  where status = 'to_issue';

create index if not exists idx_contract_billing_items_action
  on public.contract_billing_items(organization_id, action_id)
  where action_id is not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'operational_actions_project_tenant_fkey' and conrelid = 'public.operational_actions'::regclass) then
    alter table public.operational_actions add constraint operational_actions_project_tenant_fkey
      foreign key (organization_id, project_id) references public.projects(organization_id, id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'operational_actions_assignee_tenant_fkey' and conrelid = 'public.operational_actions'::regclass) then
    alter table public.operational_actions add constraint operational_actions_assignee_tenant_fkey
      foreign key (organization_id, assigned_membership_id) references public.organization_memberships(organization_id, id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'operational_actions_creator_tenant_fkey' and conrelid = 'public.operational_actions'::regclass) then
    alter table public.operational_actions add constraint operational_actions_creator_tenant_fkey
      foreign key (organization_id, created_by_membership_id) references public.organization_memberships(organization_id, id) on delete restrict;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'contract_progress_reports_project_tenant_fkey' and conrelid = 'public.contract_progress_reports'::regclass) then
    alter table public.contract_progress_reports add constraint contract_progress_reports_project_tenant_fkey
      foreign key (organization_id, project_id) references public.projects(organization_id, id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'contract_progress_reports_creator_tenant_fkey' and conrelid = 'public.contract_progress_reports'::regclass) then
    alter table public.contract_progress_reports add constraint contract_progress_reports_creator_tenant_fkey
      foreign key (organization_id, created_by_membership_id) references public.organization_memberships(organization_id, id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'contract_progress_reports_submitter_tenant_fkey' and conrelid = 'public.contract_progress_reports'::regclass) then
    alter table public.contract_progress_reports add constraint contract_progress_reports_submitter_tenant_fkey
      foreign key (organization_id, submitted_by_membership_id) references public.organization_memberships(organization_id, id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'contract_progress_reports_approver_tenant_fkey' and conrelid = 'public.contract_progress_reports'::regclass) then
    alter table public.contract_progress_reports add constraint contract_progress_reports_approver_tenant_fkey
      foreign key (organization_id, approved_by_membership_id) references public.organization_memberships(organization_id, id) on delete restrict;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'contract_billing_items_progress_project_tenant_fkey' and conrelid = 'public.contract_billing_items'::regclass) then
    alter table public.contract_billing_items add constraint contract_billing_items_progress_project_tenant_fkey
      foreign key (organization_id, progress_report_id, project_id)
      references public.contract_progress_reports(organization_id, id, project_id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'contract_billing_items_action_tenant_fkey' and conrelid = 'public.contract_billing_items'::regclass) then
    alter table public.contract_billing_items add constraint contract_billing_items_action_tenant_fkey
      foreign key (organization_id, action_id) references public.operational_actions(organization_id, id) on delete restrict;
  end if;
end $$;

create or replace function private.validate_contract_progress_report_project()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if tg_op = 'INSERT'
     or new.organization_id is distinct from old.organization_id
     or new.project_id is distinct from old.project_id then
    if not exists (
      select 1
      from public.projects project
      where project.organization_id = new.organization_id
        and project.id = new.project_id
        and project.contract_watch_enabled = true
        and project.archived_at is null
    ) then
      raise exception 'La commessa deve essere ContractWatch e non archiviata.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists contract_progress_reports_project_guard on public.contract_progress_reports;
create trigger contract_progress_reports_project_guard
before insert or update of organization_id, project_id on public.contract_progress_reports
for each row execute function private.validate_contract_progress_report_project();

create or replace function private.contractwatch_approve_progress_report(
  p_organization_id uuid,
  p_progress_report_id uuid,
  p_actor_membership_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_sal public.contract_progress_reports%rowtype;
  v_project public.projects%rowtype;
  v_billing public.contract_billing_items%rowtype;
  v_action public.operational_actions%rowtype;
  v_deduplication_key text;
begin
  if p_organization_id is null or p_progress_report_id is null or p_actor_membership_id is null then
    raise exception 'Contesto di approvazione incompleto.' using errcode = '22004';
  end if;

  if not exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = p_organization_id
      and membership.id = p_actor_membership_id
      and membership.active = true
  ) then
    raise exception 'Membership approvatore non valida.' using errcode = '42501';
  end if;

  select report.* into v_sal
  from public.contract_progress_reports report
  where report.organization_id = p_organization_id
    and report.id = p_progress_report_id
  for update;

  if not found then
    raise exception 'SAL non trovato.' using errcode = 'P0002';
  end if;

  select project.* into v_project
  from public.projects project
  where project.organization_id = p_organization_id
    and project.id = v_sal.project_id
    and project.contract_watch_enabled = true
    and project.archived_at is null;

  if not found then
    raise exception 'Commessa ContractWatch non valida o archiviata.' using errcode = '23514';
  end if;

  if v_sal.status = 'approved' then
    select item.* into v_billing
    from public.contract_billing_items item
    where item.organization_id = p_organization_id
      and item.progress_report_id = v_sal.id
      and item.status in ('to_issue', 'issued')
    order by item.created_at desc
    limit 1;

    if not found then
      raise exception 'SAL approvato senza voce di fatturazione.' using errcode = '23514';
    end if;

    select action.* into v_action
    from public.operational_actions action
    where action.organization_id = p_organization_id
      and action.id = v_billing.action_id;

    return jsonb_build_object('progress_report', to_jsonb(v_sal), 'billing_item', to_jsonb(v_billing), 'operational_action', to_jsonb(v_action));
  end if;

  if v_sal.status <> 'submitted' then
    raise exception 'Il SAL deve essere submitted per essere approvato.' using errcode = '23514';
  end if;

  update public.contract_progress_reports
  set status = 'approved', approved_at = now(), approved_by_membership_id = p_actor_membership_id,
      rejection_reason = null, updated_at = now()
  where organization_id = p_organization_id and id = v_sal.id
  returning * into v_sal;

  insert into public.contract_billing_items (
    organization_id, project_id, progress_report_id, amount, currency, status
  ) values (
    p_organization_id, v_sal.project_id, v_sal.id, v_sal.amount, v_sal.currency, 'to_issue'
  )
  returning * into v_billing;

  v_deduplication_key := 'contract_progress_report:' || v_sal.id::text || ':invoice_to_issue';

  insert into public.operational_actions (
    organization_id, action_type, status, title, detail, entity_type, entity_id,
    project_id, assigned_membership_id, created_by_membership_id,
    deduplication_key, metadata
  ) values (
    p_organization_id, 'invoice_to_issue', 'open', 'Fattura da emettere',
    'SAL ' || v_sal.sal_number || ' approvato per ' || v_sal.amount::text || ' ' || v_sal.currency || '.',
    'contract_billing_item', v_billing.id, v_sal.project_id,
    v_project.responsible_membership_id, p_actor_membership_id,
    v_deduplication_key,
    jsonb_build_object('progress_report_id', v_sal.id, 'sal_number', v_sal.sal_number, 'amount', v_sal.amount, 'currency', v_sal.currency)
  )
  on conflict (organization_id, deduplication_key) where deduplication_key is not null
  do update set deduplication_key = excluded.deduplication_key
  returning * into v_action;

  if v_action.entity_type <> 'contract_billing_item'
     or v_action.entity_id <> v_billing.id
     or v_action.project_id <> v_sal.project_id then
    raise exception 'Conflitto nella creazione dell''azione di fatturazione.' using errcode = '23505';
  end if;

  update public.contract_billing_items
  set action_id = v_action.id, updated_at = now()
  where organization_id = p_organization_id and id = v_billing.id
  returning * into v_billing;

  insert into public.activities (
    organization_id, title, type, detail, project_code, entity_type, entity_id,
    action, actor_membership_id, metadata
  ) values (
    p_organization_id, 'SAL approvato', 'ContractWatch',
    v_sal.sal_number || ' · ' || v_sal.title, v_project.project_code,
    'contract_progress_report', v_sal.id, 'approved', p_actor_membership_id,
    jsonb_build_object('changed_fields', jsonb_build_array('status', 'approved_at', 'approved_by_membership_id'), 'billing_item_id', v_billing.id, 'action_id', v_action.id)
  );

  return jsonb_build_object('progress_report', to_jsonb(v_sal), 'billing_item', to_jsonb(v_billing), 'operational_action', to_jsonb(v_action));
end;
$$;

create or replace function private.contractwatch_issue_billing_item(
  p_organization_id uuid,
  p_billing_item_id uuid,
  p_actor_membership_id uuid,
  p_invoice_reference text
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_billing public.contract_billing_items%rowtype;
  v_action public.operational_actions%rowtype;
  v_project public.projects%rowtype;
  v_reference text := nullif(btrim(p_invoice_reference), '');
begin
  if p_organization_id is null or p_billing_item_id is null or p_actor_membership_id is null or v_reference is null then
    raise exception 'Contesto di emissione incompleto.' using errcode = '22004';
  end if;

  if not exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = p_organization_id
      and membership.id = p_actor_membership_id
      and membership.active = true
  ) then
    raise exception 'Membership autore non valida.' using errcode = '42501';
  end if;

  select item.* into v_billing
  from public.contract_billing_items item
  where item.organization_id = p_organization_id and item.id = p_billing_item_id
  for update;

  if not found then
    raise exception 'Voce da fatturare non trovata.' using errcode = 'P0002';
  end if;

  if v_billing.status = 'issued' then
    if v_billing.invoice_reference <> v_reference then
      raise exception 'La voce risulta già emessa con un riferimento differente.' using errcode = '23514';
    end if;
    select action.* into v_action from public.operational_actions action
      where action.organization_id = p_organization_id and action.id = v_billing.action_id;
    return jsonb_build_object('billing_item', to_jsonb(v_billing), 'operational_action', to_jsonb(v_action));
  end if;

  if v_billing.status <> 'to_issue' then
    raise exception 'La voce non è nello stato to_issue.' using errcode = '23514';
  end if;

  select action.* into v_action
  from public.operational_actions action
  where action.organization_id = p_organization_id and action.id = v_billing.action_id
  for update;

  if not found or v_action.status <> 'open' then
    raise exception 'Azione di fatturazione aperta non trovata.' using errcode = '23514';
  end if;

  select project.* into v_project from public.projects project
  where project.organization_id = p_organization_id and project.id = v_billing.project_id;

  update public.contract_billing_items
  set status = 'issued', issued_at = now(), invoice_reference = v_reference, updated_at = now()
  where organization_id = p_organization_id and id = v_billing.id
  returning * into v_billing;

  update public.operational_actions
  set status = 'done', completed_at = now(), updated_at = now()
  where organization_id = p_organization_id and id = v_action.id
  returning * into v_action;

  insert into public.activities (
    organization_id, title, type, detail, project_code, entity_type, entity_id,
    action, actor_membership_id, metadata
  ) values (
    p_organization_id, 'Fattura emessa', 'ContractWatch',
    'Riferimento ' || v_reference, v_project.project_code,
    'contract_billing_item', v_billing.id, 'issued', p_actor_membership_id,
    jsonb_build_object('changed_fields', jsonb_build_array('status', 'issued_at', 'invoice_reference'), 'action_id', v_action.id)
  );

  return jsonb_build_object('billing_item', to_jsonb(v_billing), 'operational_action', to_jsonb(v_action));
end;
$$;

-- Public service-role-only gateways are required by the current PostgREST
-- backend. The transactional implementations remain in the non-exposed
-- private schema and both layers are denied to browser roles.
create or replace function public.contractwatch_approve_progress_report(
  p_organization_id uuid,
  p_progress_report_id uuid,
  p_actor_membership_id uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog
as $$
  select private.contractwatch_approve_progress_report($1, $2, $3);
$$;

create or replace function public.contractwatch_issue_billing_item(
  p_organization_id uuid,
  p_billing_item_id uuid,
  p_actor_membership_id uuid,
  p_invoice_reference text
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog
as $$
  select private.contractwatch_issue_billing_item($1, $2, $3, $4);
$$;

alter table public.contract_progress_reports enable row level security;
alter table public.contract_billing_items enable row level security;
alter table public.operational_actions enable row level security;

revoke all on table public.contract_progress_reports from anon, authenticated;
revoke all on table public.contract_billing_items from anon, authenticated;
revoke all on table public.operational_actions from anon, authenticated;

grant select, insert, update, delete on table public.contract_progress_reports to service_role;
grant select, insert, update, delete on table public.contract_billing_items to service_role;
grant select, insert, update, delete on table public.operational_actions to service_role;

revoke execute on function private.validate_contract_progress_report_project() from public, anon, authenticated;
revoke execute on function private.contractwatch_approve_progress_report(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function private.contractwatch_issue_billing_item(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.contractwatch_approve_progress_report(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.contractwatch_issue_billing_item(uuid, uuid, uuid, text) from public, anon, authenticated;

grant usage on schema private to service_role;
grant execute on function private.validate_contract_progress_report_project() to service_role;
grant execute on function private.contractwatch_approve_progress_report(uuid, uuid, uuid) to service_role;
grant execute on function private.contractwatch_issue_billing_item(uuid, uuid, uuid, text) to service_role;
grant execute on function public.contractwatch_approve_progress_report(uuid, uuid, uuid) to service_role;
grant execute on function public.contractwatch_issue_billing_item(uuid, uuid, uuid, text) to service_role;
