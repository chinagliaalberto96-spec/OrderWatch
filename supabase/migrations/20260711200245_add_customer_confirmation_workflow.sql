
create table if not exists public.customer_confirmations (
  id uuid primary key default gen_random_uuid(),
  source_email_id uuid references public.processed_emails(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  project_code text,
  order_id uuid references public.orders(id) on delete set null,
  order_code text,
  customer_name text,
  customer_email text not null,
  subject text not null,
  body text not null,
  status text not null default 'draft'
    check (status in ('draft','approved','sent','failed','cancelled')),
  approval_required boolean not null default true,
  prepared_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by text,
  sender_mailbox_id uuid references public.mailboxes(id) on delete set null,
  sent_at timestamptz,
  smtp_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists customer_confirmations_source_email_unique
  on public.customer_confirmations(source_email_id)
  where source_email_id is not null and status <> 'cancelled';

create index if not exists customer_confirmations_status_idx
  on public.customer_confirmations(status, created_at desc);

alter table public.customer_confirmations enable row level security;
revoke all on table public.customer_confirmations from anon, authenticated;
grant select, insert, update, delete on table public.customer_confirmations to service_role;

insert into public.settings (key, value, type, "group", description, customer_visible, status)
values
  ('automation.mode', 'assisted', 'string', 'automation', 'Modalita generale: monitor, assisted o automatic', true, 'active'),
  ('customer_confirmation.enabled', 'true', 'boolean', 'customer_confirmation', 'Abilita il flusso di conferma ricezione ordine cliente', true, 'active'),
  ('customer_confirmation.prepare_drafts', 'true', 'boolean', 'customer_confirmation', 'Prepara automaticamente una bozza dai dati estratti', true, 'active'),
  ('customer_confirmation.send_mode', 'approval_required', 'string', 'customer_confirmation', 'Richiede approvazione buyer prima dell invio', true, 'active'),
  ('customer_confirmation.auto_send', 'false', 'boolean', 'customer_confirmation', 'Invia automaticamente solo quando esplicitamente abilitato', true, 'active'),
  ('customer_confirmation.minimum_confidence', '0.90', 'number', 'customer_confirmation', 'Confidenza minima per proporre la conferma senza revisione dati', true, 'active')
on conflict (key) do nothing;
