
create index if not exists customer_confirmations_project_id_idx
  on public.customer_confirmations(project_id)
  where project_id is not null;
create index if not exists customer_confirmations_order_id_idx
  on public.customer_confirmations(order_id)
  where order_id is not null;
create index if not exists customer_confirmations_sender_mailbox_id_idx
  on public.customer_confirmations(sender_mailbox_id)
  where sender_mailbox_id is not null;
