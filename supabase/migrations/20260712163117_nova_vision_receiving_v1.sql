-- Modulo generico OrderWatch: ordini a righe, DDT e ricezioni parziali.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_orders_org_id ON public.orders(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_material_lines_org_id ON public.material_lines(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_delivery_notes_org_id ON public.delivery_notes(organization_id, id);

CREATE TABLE IF NOT EXISTS public.purchase_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL,
  line_number integer NOT NULL CHECK (line_number > 0),
  internal_item_code text,
  supplier_item_code text,
  description text NOT NULL,
  ordered_quantity numeric(18,4) NOT NULL CHECK (ordered_quantity > 0),
  confirmed_quantity numeric(18,4) CHECK (confirmed_quantity IS NULL OR confirmed_quantity >= 0),
  unit_of_measure text NOT NULL,
  unit_price numeric(18,4) CHECK (unit_price IS NULL OR unit_price >= 0),
  total_price numeric(18,2) CHECK (total_price IS NULL OR total_price >= 0),
  promised_date date,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ordered','confirmed','partially_received','received','over_received','disputed','cancelled')),
  source_material_line_id uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_purchase_order_lines_order_tenant FOREIGN KEY (organization_id, order_id) REFERENCES public.orders(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_purchase_order_lines_material_tenant FOREIGN KEY (organization_id, source_material_line_id) REFERENCES public.material_lines(organization_id, id) ON DELETE SET NULL,
  CONSTRAINT uniq_purchase_order_line_number UNIQUE (organization_id, order_id, line_number),
  CONSTRAINT uniq_purchase_order_lines_org_id UNIQUE (organization_id, id)
);

CREATE TABLE IF NOT EXISTS public.delivery_note_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  delivery_note_id uuid NOT NULL,
  line_number integer NOT NULL CHECK (line_number > 0),
  internal_item_code text,
  supplier_item_code text,
  description text NOT NULL,
  delivered_quantity numeric(18,4) NOT NULL CHECK (delivered_quantity > 0),
  unit_of_measure text NOT NULL,
  lot_reference text,
  confidence numeric(4,3) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  needs_review boolean NOT NULL DEFAULT true,
  source_material_line_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_delivery_note_lines_note_tenant FOREIGN KEY (organization_id, delivery_note_id) REFERENCES public.delivery_notes(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_delivery_note_lines_material_tenant FOREIGN KEY (organization_id, source_material_line_id) REFERENCES public.material_lines(organization_id, id) ON DELETE SET NULL,
  CONSTRAINT uniq_delivery_note_line_number UNIQUE (organization_id, delivery_note_id, line_number),
  CONSTRAINT uniq_delivery_note_lines_org_id UNIQUE (organization_id, id)
);

CREATE TABLE IF NOT EXISTS public.receipt_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  delivery_note_line_id uuid NOT NULL,
  purchase_order_line_id uuid NOT NULL,
  allocated_quantity numeric(18,4) NOT NULL CHECK (allocated_quantity > 0),
  match_method text NOT NULL DEFAULT 'manual' CHECK (match_method IN ('order_reference','supplier_item_code','internal_item_code','description','manual')),
  confidence numeric(4,3) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','confirmed','rejected','reversed')),
  confirmed_by text,
  confirmed_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_receipt_allocation_ddt_line_tenant FOREIGN KEY (organization_id, delivery_note_line_id) REFERENCES public.delivery_note_lines(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_receipt_allocation_order_line_tenant FOREIGN KEY (organization_id, purchase_order_line_id) REFERENCES public.purchase_order_lines(organization_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_purchase_order_lines_order ON public.purchase_order_lines(organization_id, order_id, line_number);
CREATE INDEX IF NOT EXISTS idx_purchase_order_lines_status ON public.purchase_order_lines(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_purchase_order_lines_supplier_code ON public.purchase_order_lines(organization_id, supplier_item_code);
CREATE INDEX IF NOT EXISTS idx_delivery_note_lines_note ON public.delivery_note_lines(organization_id, delivery_note_id, line_number);
CREATE INDEX IF NOT EXISTS idx_delivery_note_lines_supplier_code ON public.delivery_note_lines(organization_id, supplier_item_code);
CREATE INDEX IF NOT EXISTS idx_receipt_allocations_order_line ON public.receipt_allocations(organization_id, purchase_order_line_id, status);
CREATE INDEX IF NOT EXISTS idx_receipt_allocations_ddt_line ON public.receipt_allocations(organization_id, delivery_note_line_id, status);

ALTER TABLE public.delivery_notes ADD COLUMN IF NOT EXISTS confirmed_at timestamptz, ADD COLUMN IF NOT EXISTS confirmed_by text;
ALTER TABLE public.delivery_notes DROP CONSTRAINT IF EXISTS delivery_notes_status_check;
ALTER TABLE public.delivery_notes ADD CONSTRAINT delivery_notes_status_check CHECK (status IN ('new','extracted','to_review','partially_matched','matched','partial','confirmed','archived'));

DROP TRIGGER IF EXISTS trg_set_updated_at ON public.purchase_order_lines;
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.purchase_order_lines FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_set_updated_at ON public.delivery_note_lines;
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.delivery_note_lines FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_set_updated_at ON public.receipt_allocations;
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.receipt_allocations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.purchase_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_note_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipt_allocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.purchase_order_lines FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.delivery_note_lines FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.receipt_allocations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.purchase_order_lines TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.delivery_note_lines TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.receipt_allocations TO service_role;
