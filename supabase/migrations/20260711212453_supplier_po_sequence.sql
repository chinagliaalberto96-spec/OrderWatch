-- Codice ordine d'acquisto interno stabile e univoco: PO-<n>
CREATE SEQUENCE IF NOT EXISTS public.supplier_po_seq START WITH 1;

CREATE OR REPLACE FUNCTION public.next_supplier_po_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_val bigint;
BEGIN
  next_val := nextval('public.supplier_po_seq');
  RETURN 'PO-' || LPAD(next_val::text, 4, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.next_supplier_po_code() FROM public;
