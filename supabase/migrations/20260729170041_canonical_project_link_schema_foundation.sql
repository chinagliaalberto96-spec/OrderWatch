-- Phase 2D.1B.1: additive canonical project-link history foundation.
-- Public read contracts continue to use the existing legacy project fields.

CREATE TABLE public.project_link_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL
    REFERENCES public.organizations(id) ON DELETE RESTRICT,
  decision_origin text NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_link_decisions_origin_check CHECK (
    decision_origin IN (
      'SOURCE_NATIVE_STRUCTURED',
      'EXACT_TRUSTED_REFERENCE',
      'MANUAL_CONFIRMATION',
      'IMPORTED_HISTORICAL'
    )
  ),
  CONSTRAINT uniq_project_link_decisions_org_id
    UNIQUE (organization_id, id)
);

CREATE FUNCTION public.prevent_project_link_decision_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'project_link_decisions are immutable'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER trg_project_link_decisions_immutable
BEFORE UPDATE OR DELETE ON public.project_link_decisions
FOR EACH ROW EXECUTE FUNCTION public.prevent_project_link_decision_mutation();

CREATE TABLE public.order_project_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  order_id uuid NOT NULL,
  project_id uuid NOT NULL,
  decision_id uuid NOT NULL,
  valid_from timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  superseded_by_id uuid,
  ended_by_decision_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uniq_order_project_links_subject_id
    UNIQUE (organization_id, order_id, id),
  CONSTRAINT fk_order_project_links_organization
    FOREIGN KEY (organization_id)
    REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_order_project_links_order_tenant
    FOREIGN KEY (organization_id, order_id)
    REFERENCES public.orders(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_order_project_links_project_tenant
    FOREIGN KEY (organization_id, project_id)
    REFERENCES public.projects(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_order_project_links_decision_tenant
    FOREIGN KEY (organization_id, decision_id)
    REFERENCES public.project_link_decisions(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_order_project_links_ending_decision_tenant
    FOREIGN KEY (organization_id, ended_by_decision_id)
    REFERENCES public.project_link_decisions(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_order_project_links_superseded_by_subject
    FOREIGN KEY (organization_id, order_id, superseded_by_id)
    REFERENCES public.order_project_links(organization_id, order_id, id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT order_project_links_no_self_supersession
    CHECK (superseded_by_id IS NULL OR superseded_by_id <> id),
  CONSTRAINT order_project_links_ending_decision_differs_check
    CHECK (ended_by_decision_id IS NULL OR ended_by_decision_id <> decision_id),
  CONSTRAINT order_project_links_state_check CHECK (
    (
      superseded_at IS NULL
      AND superseded_by_id IS NULL
      AND ended_by_decision_id IS NULL
    )
    OR
    (
      superseded_at IS NOT NULL
      AND superseded_by_id IS NOT NULL
      AND ended_by_decision_id IS NULL
      AND superseded_at >= valid_from
    )
    OR
    (
      superseded_at IS NOT NULL
      AND superseded_by_id IS NULL
      AND ended_by_decision_id IS NOT NULL
      AND superseded_at >= valid_from
    )
  )
);

CREATE UNIQUE INDEX uniq_order_project_links_active
  ON public.order_project_links(organization_id, order_id)
  WHERE superseded_at IS NULL;

CREATE INDEX idx_order_project_links_project
  ON public.order_project_links(organization_id, project_id);

CREATE INDEX idx_order_project_links_order_history
  ON public.order_project_links(organization_id, order_id, valid_from, id);

CREATE TABLE public.line_project_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  line_id uuid NOT NULL,
  project_id uuid NOT NULL,
  decision_id uuid NOT NULL,
  valid_from timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  superseded_by_id uuid,
  ended_by_decision_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uniq_line_project_links_subject_id
    UNIQUE (organization_id, line_id, id),
  CONSTRAINT fk_line_project_links_organization
    FOREIGN KEY (organization_id)
    REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_line_project_links_line_tenant
    FOREIGN KEY (organization_id, line_id)
    REFERENCES public.purchase_order_lines(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_line_project_links_project_tenant
    FOREIGN KEY (organization_id, project_id)
    REFERENCES public.projects(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_line_project_links_decision_tenant
    FOREIGN KEY (organization_id, decision_id)
    REFERENCES public.project_link_decisions(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_line_project_links_ending_decision_tenant
    FOREIGN KEY (organization_id, ended_by_decision_id)
    REFERENCES public.project_link_decisions(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_line_project_links_superseded_by_subject
    FOREIGN KEY (organization_id, line_id, superseded_by_id)
    REFERENCES public.line_project_links(organization_id, line_id, id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT line_project_links_no_self_supersession
    CHECK (superseded_by_id IS NULL OR superseded_by_id <> id),
  CONSTRAINT line_project_links_ending_decision_differs_check
    CHECK (ended_by_decision_id IS NULL OR ended_by_decision_id <> decision_id),
  CONSTRAINT line_project_links_state_check CHECK (
    (
      superseded_at IS NULL
      AND superseded_by_id IS NULL
      AND ended_by_decision_id IS NULL
    )
    OR
    (
      superseded_at IS NOT NULL
      AND superseded_by_id IS NOT NULL
      AND ended_by_decision_id IS NULL
      AND superseded_at >= valid_from
    )
    OR
    (
      superseded_at IS NOT NULL
      AND superseded_by_id IS NULL
      AND ended_by_decision_id IS NOT NULL
      AND superseded_at >= valid_from
    )
  )
);

CREATE UNIQUE INDEX uniq_line_project_links_active
  ON public.line_project_links(organization_id, line_id)
  WHERE superseded_at IS NULL;

CREATE INDEX idx_line_project_links_project
  ON public.line_project_links(organization_id, project_id);

CREATE INDEX idx_line_project_links_line_history
  ON public.line_project_links(organization_id, line_id, valid_from, id);

CREATE FUNCTION public.guard_order_project_link_history()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'order_project_links history cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.organization_id IS DISTINCT FROM NEW.organization_id
    OR OLD.order_id IS DISTINCT FROM NEW.order_id
    OR OLD.project_id IS DISTINCT FROM NEW.project_id
    OR OLD.decision_id IS DISTINCT FROM NEW.decision_id
    OR OLD.valid_from IS DISTINCT FROM NEW.valid_from
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
  THEN
    RAISE EXCEPTION 'order_project_links facts cannot be rewritten'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.superseded_at IS NOT NULL
    OR OLD.superseded_by_id IS NOT NULL
    OR OLD.ended_by_decision_id IS NOT NULL
  THEN
    RAISE EXCEPTION 'closed order_project_links are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.superseded_at IS NULL
    OR (
      (NEW.superseded_by_id IS NULL)
      = (NEW.ended_by_decision_id IS NULL)
    )
  THEN
    RAISE EXCEPTION 'order_project_links may only transition once from active to replaced or terminally ended'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_order_project_links_history_guard
BEFORE UPDATE OR DELETE ON public.order_project_links
FOR EACH ROW EXECUTE FUNCTION public.guard_order_project_link_history();

CREATE FUNCTION public.guard_line_project_link_history()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'line_project_links history cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.organization_id IS DISTINCT FROM NEW.organization_id
    OR OLD.line_id IS DISTINCT FROM NEW.line_id
    OR OLD.project_id IS DISTINCT FROM NEW.project_id
    OR OLD.decision_id IS DISTINCT FROM NEW.decision_id
    OR OLD.valid_from IS DISTINCT FROM NEW.valid_from
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
  THEN
    RAISE EXCEPTION 'line_project_links facts cannot be rewritten'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.superseded_at IS NOT NULL
    OR OLD.superseded_by_id IS NOT NULL
    OR OLD.ended_by_decision_id IS NOT NULL
  THEN
    RAISE EXCEPTION 'closed line_project_links are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.superseded_at IS NULL
    OR (
      (NEW.superseded_by_id IS NULL)
      = (NEW.ended_by_decision_id IS NULL)
    )
  THEN
    RAISE EXCEPTION 'line_project_links may only transition once from active to replaced or terminally ended'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_line_project_links_history_guard
BEFORE UPDATE OR DELETE ON public.line_project_links
FOR EACH ROW EXECUTE FUNCTION public.guard_line_project_link_history();

CREATE FUNCTION public.assert_order_project_link_chain()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  active_count integer;
  cycle_found boolean;
  target_decision_id uuid;
  target_valid_from timestamptz;
BEGIN
  SELECT count(*)
  INTO active_count
  FROM public.order_project_links
  WHERE organization_id = NEW.organization_id
    AND order_id = NEW.order_id
    AND superseded_at IS NULL;

  IF active_count > 1 THEN
    RAISE EXCEPTION 'order project-link history cannot contain more than one active row'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.superseded_by_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT decision_id, valid_from
  INTO target_decision_id, target_valid_from
  FROM public.order_project_links
  WHERE organization_id = NEW.organization_id
    AND order_id = NEW.order_id
    AND id = NEW.superseded_by_id;

  IF target_decision_id = NEW.decision_id THEN
    RAISE EXCEPTION 'superseding order project link requires a new decision'
      USING ERRCODE = '23514';
  END IF;

  IF target_valid_from < NEW.superseded_at THEN
    RAISE EXCEPTION 'order project-link validity periods cannot overlap'
      USING ERRCODE = '23514';
  END IF;

  WITH RECURSIVE chain AS (
    SELECT
      link.id,
      link.superseded_by_id,
      ARRAY[link.id]::uuid[] AS path,
      false AS has_cycle
    FROM public.order_project_links AS link
    WHERE link.organization_id = NEW.organization_id
      AND link.order_id = NEW.order_id
      AND link.id = NEW.superseded_by_id

    UNION ALL

    SELECT
      next_link.id,
      next_link.superseded_by_id,
      chain.path || next_link.id,
      next_link.id = ANY(chain.path)
    FROM chain
    JOIN public.order_project_links AS next_link
      ON next_link.organization_id = NEW.organization_id
     AND next_link.order_id = NEW.order_id
     AND next_link.id = chain.superseded_by_id
    WHERE NOT chain.has_cycle
  )
  SELECT EXISTS (
    SELECT 1
    FROM chain
    WHERE id = NEW.id OR has_cycle
  )
  INTO cycle_found;

  IF cycle_found THEN
    RAISE EXCEPTION 'cyclic order project-link supersession is not allowed'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_order_project_links_chain_guard
AFTER INSERT OR UPDATE ON public.order_project_links
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.assert_order_project_link_chain();

CREATE FUNCTION public.assert_line_project_link_chain()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  active_count integer;
  cycle_found boolean;
  target_decision_id uuid;
  target_valid_from timestamptz;
BEGIN
  SELECT count(*)
  INTO active_count
  FROM public.line_project_links
  WHERE organization_id = NEW.organization_id
    AND line_id = NEW.line_id
    AND superseded_at IS NULL;

  IF active_count > 1 THEN
    RAISE EXCEPTION 'line project-link history cannot contain more than one active row'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.superseded_by_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT decision_id, valid_from
  INTO target_decision_id, target_valid_from
  FROM public.line_project_links
  WHERE organization_id = NEW.organization_id
    AND line_id = NEW.line_id
    AND id = NEW.superseded_by_id;

  IF target_decision_id = NEW.decision_id THEN
    RAISE EXCEPTION 'superseding line project link requires a new decision'
      USING ERRCODE = '23514';
  END IF;

  IF target_valid_from < NEW.superseded_at THEN
    RAISE EXCEPTION 'line project-link validity periods cannot overlap'
      USING ERRCODE = '23514';
  END IF;

  WITH RECURSIVE chain AS (
    SELECT
      link.id,
      link.superseded_by_id,
      ARRAY[link.id]::uuid[] AS path,
      false AS has_cycle
    FROM public.line_project_links AS link
    WHERE link.organization_id = NEW.organization_id
      AND link.line_id = NEW.line_id
      AND link.id = NEW.superseded_by_id

    UNION ALL

    SELECT
      next_link.id,
      next_link.superseded_by_id,
      chain.path || next_link.id,
      next_link.id = ANY(chain.path)
    FROM chain
    JOIN public.line_project_links AS next_link
      ON next_link.organization_id = NEW.organization_id
     AND next_link.line_id = NEW.line_id
     AND next_link.id = chain.superseded_by_id
    WHERE NOT chain.has_cycle
  )
  SELECT EXISTS (
    SELECT 1
    FROM chain
    WHERE id = NEW.id OR has_cycle
  )
  INTO cycle_found;

  IF cycle_found THEN
    RAISE EXCEPTION 'cyclic line project-link supersession is not allowed'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_line_project_links_chain_guard
AFTER INSERT OR UPDATE ON public.line_project_links
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.assert_line_project_link_chain();

ALTER TABLE public.project_link_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_project_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.line_project_links ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.project_link_decisions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.order_project_links FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.line_project_links FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT ON TABLE public.project_link_decisions TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.order_project_links TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.line_project_links TO service_role;

REVOKE ALL ON FUNCTION public.prevent_project_link_decision_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_order_project_link_history() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_line_project_link_history() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_order_project_link_chain() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_line_project_link_chain() FROM PUBLIC;
