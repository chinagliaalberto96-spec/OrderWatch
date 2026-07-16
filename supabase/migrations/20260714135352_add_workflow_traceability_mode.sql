INSERT INTO public.settings (
  organization_id, key, value, type, "group", description, customer_visible, status
)
SELECT
  o.id,
  'workflow.traceability_mode',
  CASE WHEN o.slug = 'graphic-center' THEN 'supplier_only'
       WHEN o.slug = 'nova-vision' THEN 'required_link'
       ELSE 'assisted_link' END,
  'string',
  'workflow',
  'Sceglie il livello di tracciabilita: Essenziale (fornitore e materiali), Assistito (collegamenti suggeriti) o Completo (commessa e ordine obbligatori).',
  true,
  'active'
FROM public.organizations o
ON CONFLICT (organization_id, key) DO UPDATE SET
  description = EXCLUDED.description,
  customer_visible = true,
  updated_at = now();
