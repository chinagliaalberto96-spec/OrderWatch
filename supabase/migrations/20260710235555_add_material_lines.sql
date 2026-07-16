CREATE TABLE IF NOT EXISTS public.material_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type TEXT CHECK (
    source_type IN ('customer_request','supplier_order','internal_request','quote','invoice','ddt','manual')
  ) DEFAULT 'manual',
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  project_code TEXT,
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  order_code TEXT,
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  supplier_name TEXT,
  customer_name TEXT,
  item_code TEXT,
  description TEXT NOT NULL,
  quantity TEXT,
  unit TEXT,
  required_date DATE,
  due_date DATE,
  status TEXT CHECK (
    status IN ('Da verificare','Richiesto','Preventivo','Ordinato','Confermato','Parziale','Ricevuto','Annullato','Scartato')
  ) DEFAULT 'Da verificare',
  confidence NUMERIC(3,2),
  needs_review BOOLEAN DEFAULT TRUE,
  source_email_id UUID REFERENCES public.processed_emails(id) ON DELETE SET NULL,
  source_document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_material_lines_order_code ON public.material_lines(order_code);
CREATE INDEX IF NOT EXISTS idx_material_lines_project_code ON public.material_lines(project_code);
CREATE INDEX IF NOT EXISTS idx_material_lines_status ON public.material_lines(status);
CREATE INDEX IF NOT EXISTS idx_material_lines_source_email ON public.material_lines(source_email_id);

ALTER TABLE public.material_lines ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_set_updated_at ON public.material_lines;
CREATE TRIGGER trg_set_updated_at
BEFORE UPDATE ON public.material_lines
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
