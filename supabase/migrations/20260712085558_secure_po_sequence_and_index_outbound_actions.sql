REVOKE ALL ON FUNCTION public.next_supplier_po_code() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.next_supplier_po_code() FROM anon;
REVOKE ALL ON FUNCTION public.next_supplier_po_code() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.next_supplier_po_code() TO service_role;

CREATE INDEX IF NOT EXISTS idx_buyer_actions_source_email_id ON public.buyer_actions(source_email_id);
CREATE INDEX IF NOT EXISTS idx_buyer_actions_order_id ON public.buyer_actions(order_id);
CREATE INDEX IF NOT EXISTS idx_buyer_actions_project_id ON public.buyer_actions(project_id);
CREATE INDEX IF NOT EXISTS idx_buyer_actions_supplier_id ON public.buyer_actions(supplier_id);
CREATE INDEX IF NOT EXISTS idx_buyer_actions_material_line_id ON public.buyer_actions(material_line_id);
