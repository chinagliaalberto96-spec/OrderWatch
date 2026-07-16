INSERT INTO public.learning_rules (rule_type, pattern, outcome, priority, active, source, notes) VALUES
(
  'classification',
  'internal_sender_without_forward',
  '{"origin":"INTERNAL","type":"INTERNAL_REQUEST","legacy_classification":"OTHER","confidence":0.96,"needs_review":false,"privacy_mode":"metadata_only","reason":"Mittente interno senza inoltro/documento esterno: richiesta interna, non ordine cliente/fornitore."}'::jsonb,
  10,
  true,
  'system',
  'Evita che richieste interne tipo materiali/inchiostri diventino clienti o fornitori.'
),
(
  'classification',
  'regex:(posta-certificata|legalmail|sdi|fatturaelettronica|sistema di interscambio|<fatturaelettronica)',
  '{"origin":"ADMIN","type":"SDI_INVOICE","legacy_classification":"SUPPLIER","confidence":0.98,"needs_review":false,"privacy_mode":"full","reason":"Segnale SDI/PEC/fattura elettronica rilevato."}'::jsonb,
  20,
  true,
  'system',
  'Riconoscimento fatture elettroniche/SDI.'
),
(
  'classification',
  'regex:(ddt|documento di trasporto|bolla di consegna)',
  '{"origin":"SUPPLIER","type":"SUPPLIER_DDT","legacy_classification":"SUPPLIER","confidence":0.93,"needs_review":false,"privacy_mode":"full","reason":"Documento di trasporto/DDT rilevato."}'::jsonb,
  40,
  true,
  'system',
  'Riconoscimento DDT fornitore.'
),
(
  'classification',
  'regex:(preventivo|quotazione|offerta|offriamo|validita offerta|validita'' offerta)',
  '{"origin":"SUPPLIER","type":"SUPPLIER_QUOTE","legacy_classification":"SUPPLIER","confidence":0.88,"needs_review":false,"privacy_mode":"full","reason":"Preventivo/offerta rilevata: non trattare come ordine."}'::jsonb,
  60,
  true,
  'system',
  'Regola prudente per preventivi/offerte; puo essere superata da prompt AI se disattivata.'
),
(
  'classification',
  'regex:(fattura|nota di credito|pagamento|scadenza pagamento|insoluto)',
  '{"origin":"SUPPLIER","type":"SUPPLIER_INVOICE","legacy_classification":"SUPPLIER","confidence":0.88,"needs_review":false,"privacy_mode":"full","reason":"Documento amministrativo/fattura rilevato."}'::jsonb,
  70,
  true,
  'system',
  'Regola fatture fornitore non SDI.'
)
ON CONFLICT DO NOTHING;
