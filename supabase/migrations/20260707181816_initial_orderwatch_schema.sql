CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  on_time_rate NUMERIC(5,2) DEFAULT 0,
  open_orders_count INTEGER DEFAULT 0,
  risk_level TEXT CHECK (risk_level IN ('basso', 'medio', 'alto')) DEFAULT 'basso',
  score INTEGER DEFAULT 100,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_code TEXT UNIQUE NOT NULL,
  customer TEXT,
  owner TEXT,
  status TEXT DEFAULT 'Aperto',
  due_date DATE,
  open_orders_count INTEGER DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS processed_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id TEXT UNIQUE NOT NULL,
  mailbox TEXT,
  from_address TEXT,
  subject TEXT,
  received_at TIMESTAMPTZ,
  pre_classification TEXT,
  final_classification TEXT,
  status TEXT DEFAULT 'processing' CHECK (status IN ('processing','done','error','skipped')),
  linked_project_code TEXT,
  linked_order_code TEXT,
  error_detail TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_code TEXT UNIQUE NOT NULL,
  supplier_id UUID REFERENCES suppliers(id),
  supplier_name TEXT,
  project_id UUID REFERENCES projects(id),
  project_code TEXT,
  material TEXT,
  quantity TEXT,
  order_date DATE,
  due_date DATE,
  required_date DATE,
  days_remaining INTEGER,
  status TEXT DEFAULT 'In attesa' CHECK (
    status IN ('In attesa','Confermato','Ricevuto','In ritardo','Scaduto','Annullato','OK')
  ),
  alert_level TEXT CHECK (alert_level IN ('ok','warning','critical','overdue')) DEFAULT 'ok',
  needs_review BOOLEAN DEFAULT FALSE,
  owner TEXT,
  notes TEXT,
  source_email_id UUID REFERENCES processed_emails(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT,
  type TEXT DEFAULT 'Conferma ordine',
  supplier_id UUID REFERENCES suppliers(id),
  supplier_name TEXT,
  order_id UUID REFERENCES orders(id),
  linked_order_code TEXT,
  confidence NUMERIC(3,2),
  received_at TIMESTAMPTZ DEFAULT NOW(),
  source_email_id UUID REFERENCES processed_emails(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  type TEXT DEFAULT 'Documento',
  detail TEXT,
  order_code TEXT,
  project_code TEXT,
  supplier_name TEXT,
  date TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id),
  order_code TEXT,
  supplier_id UUID REFERENCES suppliers(id),
  supplier_name TEXT,
  supplier_email TEXT,
  subject TEXT,
  body TEXT,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft','sent','failed','replied')),
  sent_at TIMESTAMPTZ,
  error_detail TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS daily_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id TEXT UNIQUE,
  report_date DATE DEFAULT CURRENT_DATE,
  recipient_name TEXT,
  recipient_email TEXT,
  critical_orders_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft','sent','failed','skipped')),
  channel TEXT DEFAULT 'email',
  subject TEXT,
  body TEXT,
  sent_at TIMESTAMPTZ,
  error_detail TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  value TEXT,
  type TEXT DEFAULT 'string' CHECK (type IN ('string','number','boolean')),
  "group" TEXT,
  description TEXT,
  customer_visible BOOLEAN DEFAULT TRUE,
  status TEXT DEFAULT 'active' CHECK (status IN ('active','disabled','planned')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS report_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_name TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT CHECK (role IN ('Buyer','Owner','Administration','Manager','Other')) DEFAULT 'Buyer',
  active BOOLEAN DEFAULT TRUE,
  daily_report BOOLEAN DEFAULT TRUE,
  channel TEXT CHECK (channel IN ('email','teams')) DEFAULT 'email',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mailboxes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mailbox_name TEXT NOT NULL,
  email_address TEXT,
  role TEXT CHECK (role IN ('Owner','Administration','Purchasing','Suppliers','General','Other')) DEFAULT 'General',
  active BOOLEAN DEFAULT TRUE,
  connection_status TEXT CHECK (connection_status IN ('not_connected','connected','error','disabled')) DEFAULT 'not_connected',
  mailbox_source TEXT,
  make_scenario_label TEXT,
  last_check_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_alert_level ON orders(alert_level);
CREATE INDEX IF NOT EXISTS idx_orders_due_date ON orders(due_date);
CREATE INDEX IF NOT EXISTS idx_orders_supplier_id ON orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_orders_project_id ON orders(project_id);
CREATE INDEX IF NOT EXISTS idx_processed_emails_message_id ON processed_emails(message_id);
CREATE INDEX IF NOT EXISTS idx_processed_emails_status ON processed_emails(status);
CREATE INDEX IF NOT EXISTS idx_activities_date ON activities(date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_reports_report_id ON daily_reports(report_id);
CREATE INDEX IF NOT EXISTS idx_report_recipients_active ON report_recipients(active, daily_report);
CREATE INDEX IF NOT EXISTS idx_mailboxes_active ON mailboxes(active, connection_status);

INSERT INTO settings (key, value, type, "group", description, customer_visible, status) VALUES
('client.company_name', 'Graphic Center Group Srl', 'string', 'client', 'Nome azienda cliente', true, 'active'),
('client.monitored_mailboxes', '', 'string', 'client', 'Caselle monitorate', true, 'planned'),
('client.mailbox_source', 'mailboxes_table', 'string', 'client', 'Origine configurazione mailbox', true, 'planned'),
('alerts.warning_days', '5', 'number', 'alerts', 'Giorni soglia attenzione', true, 'active'),
('alerts.critical_days', '2', 'number', 'alerts', 'Giorni soglia critica', true, 'active'),
('alerts.overdue_days', '0', 'number', 'alerts', 'Giorni scaduto', true, 'active'),
('notifications.reminder_days_before_due', '3', 'number', 'notifications', 'Giorni promemoria fornitore', true, 'planned'),
('notifications.escalation_days_before_due', '1', 'number', 'notifications', 'Giorni escalation interna', true, 'planned'),
('daily_report.enabled', 'true', 'boolean', 'daily_report', 'Abilita report giornaliero', true, 'active'),
('daily_report.send_time', '09:00', 'string', 'daily_report', 'Orario invio report', true, 'active'),
('daily_report.recipient_source', 'report_recipients_table', 'string', 'daily_report', 'Origine destinatari report', true, 'planned'),
('daily_report.recipient_email', '', 'string', 'daily_report', 'Email destinatario report fallback', true, 'planned'),
('daily_report.recipient_name', 'Buyer Graphic Center', 'string', 'daily_report', 'Nome destinatario report fallback', true, 'active'),
('daily_report.send_if_no_critical', 'false', 'boolean', 'daily_report', 'Invia anche se nessun critico', true, 'active'),
('daily_report.deduplication_policy', 'one_report_per_day', 'string', 'daily_report', 'Un report al giorno per Report ID', true, 'active'),
('runtime.processed_email_policy', 'skip_duplicates', 'string', 'runtime', 'Politica email duplicate', false, 'active'),
('runtime.deduplication_key', 'Message ID', 'string', 'runtime', 'Chiave antiduplicato email', false, 'active'),
('runtime.pdf_storage_policy', 'none', 'string', 'runtime', 'PDF: non salvare allegati', false, 'active')
ON CONFLICT (key) DO NOTHING;

INSERT INTO mailboxes (mailbox_name, role, active, connection_status, mailbox_source, make_scenario_label, notes) VALUES
('Mail titolare', 'Owner', true, 'not_connected', 'MAIL_TITOLARE', 'OrderWatch - Intake Mail Titolare', 'Mailbox principale del titolare. Da collegare con credenziali reali.'),
('Mail amministrazione', 'Administration', true, 'not_connected', 'MAIL_AMMINISTRAZIONE', 'OrderWatch - Intake Mail Amministrazione', 'Mailbox amministrazione. Da collegare con credenziali reali.')
ON CONFLICT DO NOTHING;
