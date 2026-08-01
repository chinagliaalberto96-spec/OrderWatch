-- Phase 2D.1B.1 idempotency foundation: durable operation identity and
-- outcome recovery for the future canonical project-link writer.
-- This ledger does not authorize or perform canonical link mutations.

CREATE TABLE public.project_link_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL
    REFERENCES public.organizations(id) ON DELETE RESTRICT,
  operation_key text NOT NULL,
  request_fingerprint text NOT NULL,
  subject_type text NOT NULL,
  subject_id uuid NOT NULL,
  operation_type text NOT NULL,
  lifecycle_operation text NOT NULL,
  decision_origin text NOT NULL,
  intended_project_id uuid,
  expected_active_link_id uuid,
  status text NOT NULL DEFAULT 'CLAIMED',
  final_outcome text,
  decision_id uuid,
  prior_link_id uuid,
  result_link_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  last_error_class text,
  CONSTRAINT uniq_project_link_operations_org_key
    UNIQUE (organization_id, operation_key),
  CONSTRAINT uniq_project_link_operations_org_id
    UNIQUE (organization_id, id),
  CONSTRAINT project_link_operations_key_check CHECK (
    operation_key = btrim(operation_key)
    AND length(operation_key) BETWEEN 1 AND 255
  ),
  CONSTRAINT project_link_operations_fingerprint_check CHECK (
    request_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT project_link_operations_subject_type_check CHECK (
    subject_type IN ('ORDER', 'LINE')
  ),
  CONSTRAINT project_link_operations_operation_type_check CHECK (
    operation_type IN (
      'CREATE_INITIAL_LINK',
      'REPLACE_ACTIVE_LINK',
      'TERMINALLY_END_ACTIVE_LINK',
      'REACTIVATE_LINK',
      'CONFIRM_PROJECT_MANUALLY',
      'APPLY_AUTOMATIC_PROJECT_DECISION'
    )
  ),
  CONSTRAINT project_link_operations_lifecycle_operation_check CHECK (
    lifecycle_operation IN (
      'CREATE_INITIAL_LINK',
      'REPLACE_ACTIVE_LINK',
      'TERMINALLY_END_ACTIVE_LINK',
      'REACTIVATE_LINK'
    )
  ),
  CONSTRAINT project_link_operations_type_lifecycle_check CHECK (
    operation_type IN (
      'CONFIRM_PROJECT_MANUALLY',
      'APPLY_AUTOMATIC_PROJECT_DECISION'
    )
    OR operation_type = lifecycle_operation
  ),
  CONSTRAINT project_link_operations_origin_check CHECK (
    decision_origin IN (
      'SOURCE_NATIVE_STRUCTURED',
      'EXACT_TRUSTED_REFERENCE',
      'MANUAL_CONFIRMATION',
      'IMPORTED_HISTORICAL'
    )
  ),
  CONSTRAINT project_link_operations_origin_operation_check CHECK (
    (
      operation_type = 'CONFIRM_PROJECT_MANUALLY'
      AND decision_origin = 'MANUAL_CONFIRMATION'
    )
    OR
    (
      operation_type = 'APPLY_AUTOMATIC_PROJECT_DECISION'
      AND decision_origin <> 'MANUAL_CONFIRMATION'
    )
    OR operation_type NOT IN (
      'CONFIRM_PROJECT_MANUALLY',
      'APPLY_AUTOMATIC_PROJECT_DECISION'
    )
  ),
  CONSTRAINT project_link_operations_project_requirement_check CHECK (
    (
      lifecycle_operation = 'TERMINALLY_END_ACTIVE_LINK'
      AND intended_project_id IS NULL
    )
    OR
    (
      lifecycle_operation <> 'TERMINALLY_END_ACTIVE_LINK'
      AND intended_project_id IS NOT NULL
    )
  ),
  CONSTRAINT project_link_operations_expected_active_check CHECK (
    (
      lifecycle_operation IN ('CREATE_INITIAL_LINK', 'REACTIVATE_LINK')
      AND expected_active_link_id IS NULL
    )
    OR
    (
      lifecycle_operation IN ('REPLACE_ACTIVE_LINK', 'TERMINALLY_END_ACTIVE_LINK')
      AND expected_active_link_id IS NOT NULL
    )
  ),
  CONSTRAINT project_link_operations_status_check CHECK (
    status IN ('CLAIMED', 'COMPLETED', 'FAILED', 'AMBIGUOUS')
  ),
  CONSTRAINT project_link_operations_final_outcome_check CHECK (
    final_outcome IS NULL
    OR final_outcome ~ '^[A-Z][A-Z0-9_]{0,127}$'
  ),
  CONSTRAINT project_link_operations_error_class_check CHECK (
    last_error_class IS NULL
    OR last_error_class ~ '^[A-Z][A-Z0-9_]{0,127}$'
  ),
  CONSTRAINT project_link_operations_state_check CHECK (
    (
      status = 'CLAIMED'
      AND final_outcome IS NULL
      AND completed_at IS NULL
      AND last_error_class IS NULL
    )
    OR
    (
      status = 'AMBIGUOUS'
      AND final_outcome IS NULL
      AND completed_at IS NULL
      AND last_error_class IS NOT NULL
    )
    OR
    (
      status = 'COMPLETED'
      AND final_outcome IS NOT NULL
      AND completed_at IS NOT NULL
      AND last_error_class IS NULL
    )
    OR
    (
      status = 'FAILED'
      AND final_outcome IS NOT NULL
      AND completed_at IS NOT NULL
      AND last_error_class IS NOT NULL
    )
  ),
  CONSTRAINT fk_project_link_operations_intended_project_tenant
    FOREIGN KEY (organization_id, intended_project_id)
    REFERENCES public.projects(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_project_link_operations_decision_tenant
    FOREIGN KEY (organization_id, decision_id)
    REFERENCES public.project_link_decisions(organization_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_project_link_operations_subject_history
  ON public.project_link_operations(
    organization_id,
    subject_type,
    subject_id,
    created_at,
    id
  );

CREATE INDEX idx_project_link_operations_unresolved
  ON public.project_link_operations(organization_id, status, started_at, id)
  WHERE status IN ('CLAIMED', 'AMBIGUOUS');

CREATE FUNCTION public.assert_project_link_operation_references()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  subject_exists boolean;
  expected_link_exists boolean := true;
  prior_link_exists boolean := true;
  result_link_exists boolean := true;
BEGIN
  IF NEW.subject_type = 'ORDER' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.orders
      WHERE organization_id = NEW.organization_id
        AND id = NEW.subject_id
    ) INTO subject_exists;

    IF NEW.expected_active_link_id IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.order_project_links
        WHERE organization_id = NEW.organization_id
          AND order_id = NEW.subject_id
          AND id = NEW.expected_active_link_id
      ) INTO expected_link_exists;
    END IF;

    IF NEW.prior_link_id IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.order_project_links
        WHERE organization_id = NEW.organization_id
          AND order_id = NEW.subject_id
          AND id = NEW.prior_link_id
      ) INTO prior_link_exists;
    END IF;

    IF NEW.result_link_id IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.order_project_links
        WHERE organization_id = NEW.organization_id
          AND order_id = NEW.subject_id
          AND id = NEW.result_link_id
      ) INTO result_link_exists;
    END IF;
  ELSE
    SELECT EXISTS (
      SELECT 1
      FROM public.purchase_order_lines
      WHERE organization_id = NEW.organization_id
        AND id = NEW.subject_id
    ) INTO subject_exists;

    IF NEW.expected_active_link_id IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.line_project_links
        WHERE organization_id = NEW.organization_id
          AND line_id = NEW.subject_id
          AND id = NEW.expected_active_link_id
      ) INTO expected_link_exists;
    END IF;

    IF NEW.prior_link_id IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.line_project_links
        WHERE organization_id = NEW.organization_id
          AND line_id = NEW.subject_id
          AND id = NEW.prior_link_id
      ) INTO prior_link_exists;
    END IF;

    IF NEW.result_link_id IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.line_project_links
        WHERE organization_id = NEW.organization_id
          AND line_id = NEW.subject_id
          AND id = NEW.result_link_id
      ) INTO result_link_exists;
    END IF;
  END IF;

  IF NOT subject_exists THEN
    RAISE EXCEPTION 'project-link operation subject is not tenant-safe'
      USING ERRCODE = '23503';
  END IF;

  IF NOT expected_link_exists THEN
    RAISE EXCEPTION 'project-link operation expected link is not tenant-safe'
      USING ERRCODE = '23503';
  END IF;

  IF NOT prior_link_exists THEN
    RAISE EXCEPTION 'project-link operation prior link is not tenant-safe'
      USING ERRCODE = '23503';
  END IF;

  IF NOT result_link_exists THEN
    RAISE EXCEPTION 'project-link operation result link is not tenant-safe'
      USING ERRCODE = '23503';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_project_link_operations_reference_guard
BEFORE INSERT OR UPDATE ON public.project_link_operations
FOR EACH ROW EXECUTE FUNCTION public.assert_project_link_operation_references();

CREATE FUNCTION public.guard_project_link_operation_history()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'project_link_operations history cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.organization_id IS DISTINCT FROM NEW.organization_id
    OR OLD.operation_key IS DISTINCT FROM NEW.operation_key
    OR OLD.request_fingerprint IS DISTINCT FROM NEW.request_fingerprint
    OR OLD.subject_type IS DISTINCT FROM NEW.subject_type
    OR OLD.subject_id IS DISTINCT FROM NEW.subject_id
    OR OLD.operation_type IS DISTINCT FROM NEW.operation_type
    OR OLD.lifecycle_operation IS DISTINCT FROM NEW.lifecycle_operation
    OR OLD.decision_origin IS DISTINCT FROM NEW.decision_origin
    OR OLD.intended_project_id IS DISTINCT FROM NEW.intended_project_id
    OR OLD.expected_active_link_id IS DISTINCT FROM NEW.expected_active_link_id
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
    OR OLD.started_at IS DISTINCT FROM NEW.started_at
  THEN
    RAISE EXCEPTION 'project_link_operations request facts are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.status IN ('COMPLETED', 'FAILED') THEN
    RAISE EXCEPTION 'terminal project_link_operations are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.status = 'CLAIMED'
    AND NEW.status NOT IN ('COMPLETED', 'FAILED', 'AMBIGUOUS')
  THEN
    RAISE EXCEPTION 'illegal project_link_operations status transition'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.status = 'AMBIGUOUS'
    AND NEW.status NOT IN ('COMPLETED', 'FAILED')
  THEN
    RAISE EXCEPTION 'illegal project_link_operations status transition'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.decision_id IS NOT NULL
    AND OLD.decision_id IS DISTINCT FROM NEW.decision_id
  THEN
    RAISE EXCEPTION 'project_link_operations decision result is immutable once set'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.prior_link_id IS NOT NULL
    AND OLD.prior_link_id IS DISTINCT FROM NEW.prior_link_id
  THEN
    RAISE EXCEPTION 'project_link_operations prior link is immutable once set'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.result_link_id IS NOT NULL
    AND OLD.result_link_id IS DISTINCT FROM NEW.result_link_id
  THEN
    RAISE EXCEPTION 'project_link_operations result link is immutable once set'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_project_link_operations_history_guard
BEFORE UPDATE OR DELETE ON public.project_link_operations
FOR EACH ROW EXECUTE FUNCTION public.guard_project_link_operation_history();

ALTER TABLE public.project_link_operations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.project_link_operations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.project_link_operations TO service_role;

REVOKE ALL ON FUNCTION public.assert_project_link_operation_references() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_project_link_operation_history() FROM PUBLIC;
