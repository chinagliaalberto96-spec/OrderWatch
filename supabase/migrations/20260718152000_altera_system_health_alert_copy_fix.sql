-- Keep the extraction alert copy grammatically correct for both singular and plural counts.
do $$
declare
  view_definition text;
begin
  select pg_get_viewdef('public.system_health_alerts'::regclass, true)
    into view_definition;

  view_definition := replace(
    view_definition,
    'email non sono state elaborate correttamente',
    'email non elaborate correttamente'
  );

  execute 'create or replace view public.system_health_alerts '
    || 'with (security_invoker = true) as '
    || view_definition;
end;
$$;

comment on view public.system_health_alerts is
  'Technical system-health alerts for mailbox monitoring, extraction failures and data-quality regressions. Service-role only.';

revoke all on public.system_health_alerts from anon, authenticated;
grant select on public.system_health_alerts to service_role;
