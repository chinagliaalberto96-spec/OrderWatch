-- projects_org_id_key already guarantees uniqueness for tenant-safe foreign keys.
drop index if exists public.uniq_projects_org_id;
