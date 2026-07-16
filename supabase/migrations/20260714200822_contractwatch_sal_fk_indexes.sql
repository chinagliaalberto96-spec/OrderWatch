create index if not exists idx_contract_billing_items_progress_project_fk
  on public.contract_billing_items(organization_id, progress_report_id, project_id);

create index if not exists idx_contract_progress_reports_creator_fk
  on public.contract_progress_reports(organization_id, created_by_membership_id);

create index if not exists idx_contract_progress_reports_submitter_fk
  on public.contract_progress_reports(organization_id, submitted_by_membership_id)
  where submitted_by_membership_id is not null;

create index if not exists idx_contract_progress_reports_approver_fk
  on public.contract_progress_reports(organization_id, approved_by_membership_id)
  where approved_by_membership_id is not null;

create index if not exists idx_operational_actions_creator_fk
  on public.operational_actions(organization_id, created_by_membership_id);
