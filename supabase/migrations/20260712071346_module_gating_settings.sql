-- Gating moduli lato backend: controllabili SOLO da OrderWatch (noi), mai
-- editabili dal cliente. customer_visible=false li esclude dalla lista
-- "Impostazioni operative" editabile in Settings; la UI mostra solo lo stato
-- (attivo/disattivato) in sola lettura nella sezione "Moduli attivi".
INSERT INTO public.settings (key, value, type, "group", description, customer_visible, status) VALUES
('modules.dashboard', 'true', 'boolean', 'modules', 'Modulo Oggi (dashboard operativa)', false, 'active'),
('modules.orders', 'true', 'boolean', 'modules', 'Modulo Ordini materiali', false, 'active'),
('modules.projects', 'true', 'boolean', 'modules', 'Modulo Lavori', false, 'active'),
('modules.suppliers', 'true', 'boolean', 'modules', 'Modulo Fornitori', false, 'active'),
('modules.quotes', 'true', 'boolean', 'modules', 'Modulo Quotazioni', false, 'active'),
('modules.documents', 'true', 'boolean', 'modules', 'Modulo Documenti', false, 'active'),
('modules.imports', 'true', 'boolean', 'modules', 'Modulo Importazioni', false, 'active'),
('modules.reminders', 'true', 'boolean', 'modules', 'Modulo Notifiche', false, 'active'),
('modules.supplier_orders', 'true', 'boolean', 'modules', 'Modulo Ordini verso fornitori (workflow completo)', false, 'active')
ON CONFLICT (key) DO NOTHING;
