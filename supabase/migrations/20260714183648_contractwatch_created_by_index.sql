create index if not exists idx_projects_created_by_membership
  on public.projects(organization_id, created_by_membership_id)
  where created_by_membership_id is not null;
