alter table public.telegram_connections
  add column if not exists altera_conversation_id uuid
  references public.altera_conversations(id) on delete set null;

comment on column public.telegram_connections.altera_conversation_id is
  'Conversazione Altera attiva per questo collegamento Telegram.';
