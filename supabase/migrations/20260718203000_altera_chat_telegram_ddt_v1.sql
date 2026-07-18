-- Altera Chat + Telegram DDT v1.
-- All objects are backend-only: the browser talks to authenticated server
-- routes, while service_role remains the only database role with access.

create extension if not exists pgcrypto;

create table if not exists public.altera_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  app_user_id uuid references public.app_users(id) on delete set null,
  membership_id uuid references public.organization_memberships(id) on delete set null,
  title text not null default 'Nuova conversazione',
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_altera_conversations_user
  on public.altera_conversations (organization_id, app_user_id, updated_at desc);

create table if not exists public.altera_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.altera_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  highlights jsonb not null default '[]'::jsonb,
  citations jsonb not null default '[]'::jsonb,
  model text,
  prompt_tokens integer,
  completion_tokens integer,
  created_at timestamptz not null default now()
);

create index if not exists idx_altera_messages_conversation
  on public.altera_messages (organization_id, conversation_id, created_at);

create table if not exists public.telegram_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  membership_id uuid references public.organization_memberships(id) on delete set null,
  telegram_chat_id bigint not null,
  telegram_user_id bigint,
  telegram_username text,
  display_name text,
  status text not null default 'active' check (status in ('active', 'revoked')),
  connected_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz,
  unique (telegram_chat_id),
  unique (organization_id, telegram_chat_id)
);

create index if not exists idx_telegram_connections_org_status
  on public.telegram_connections (organization_id, status, connected_at desc);

create table if not exists public.telegram_pairing_codes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  membership_id uuid references public.organization_memberships(id) on delete cascade,
  code_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create index if not exists idx_telegram_pairing_codes_org_expiry
  on public.telegram_pairing_codes (organization_id, expires_at desc)
  where used_at is null;

create table if not exists public.telegram_ddt_submissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid references public.telegram_connections(id) on delete set null,
  telegram_chat_id bigint not null,
  telegram_message_id bigint not null,
  telegram_file_unique_id text,
  media_group_id text,
  delivery_note_id uuid references public.delivery_notes(id) on delete set null,
  status text not null default 'processing' check (
    status in ('processing', 'needs_review', 'completed', 'duplicate', 'failed')
  ),
  extraction jsonb,
  error_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (telegram_chat_id, telegram_message_id)
);

create index if not exists idx_telegram_ddt_submissions_org
  on public.telegram_ddt_submissions (organization_id, created_at desc);

create table if not exists public.telegram_bot_state (
  bot_key text primary key,
  update_offset bigint,
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_altera_conversations_updated_at on public.altera_conversations;
create trigger trg_altera_conversations_updated_at before update on public.altera_conversations
  for each row execute function public.set_updated_at();

drop trigger if exists trg_telegram_ddt_submissions_updated_at on public.telegram_ddt_submissions;
create trigger trg_telegram_ddt_submissions_updated_at before update on public.telegram_ddt_submissions
  for each row execute function public.set_updated_at();

alter table public.altera_conversations enable row level security;
alter table public.altera_messages enable row level security;
alter table public.telegram_connections enable row level security;
alter table public.telegram_pairing_codes enable row level security;
alter table public.telegram_ddt_submissions enable row level security;
alter table public.telegram_bot_state enable row level security;

revoke all on table public.altera_conversations from public, anon, authenticated;
revoke all on table public.altera_messages from public, anon, authenticated;
revoke all on table public.telegram_connections from public, anon, authenticated;
revoke all on table public.telegram_pairing_codes from public, anon, authenticated;
revoke all on table public.telegram_ddt_submissions from public, anon, authenticated;
revoke all on table public.telegram_bot_state from public, anon, authenticated;

grant select, insert, update, delete on table public.altera_conversations to service_role;
grant select, insert, update, delete on table public.altera_messages to service_role;
grant select, insert, update, delete on table public.telegram_connections to service_role;
grant select, insert, update, delete on table public.telegram_pairing_codes to service_role;
grant select, insert, update, delete on table public.telegram_ddt_submissions to service_role;
grant select, insert, update, delete on table public.telegram_bot_state to service_role;
