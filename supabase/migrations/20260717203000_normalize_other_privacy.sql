-- OTHER emails never expose content in the product. Keep only the metadata
-- classification marker used by the UI and audit trail.
update public.processed_emails
set
  privacy_mode = 'metadata_only',
  updated_at = now()
where final_classification = 'OTHER'
  and privacy_mode is distinct from 'metadata_only';
