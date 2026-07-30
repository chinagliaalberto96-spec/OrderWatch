-- Phase 2D.1B.1 hardening: a manually confirmed active project link may only
-- be replaced or terminally ended by another manual confirmation.

CREATE FUNCTION public.assert_order_project_link_manual_precedence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  opening_origin text;
  ending_origin text;
BEGIN
  IF OLD.superseded_at IS NOT NULL
    OR NEW.superseded_at IS NULL
  THEN
    RETURN NEW;
  END IF;

  SELECT decision_origin
  INTO opening_origin
  FROM public.project_link_decisions
  WHERE organization_id = OLD.organization_id
    AND id = OLD.decision_id;

  IF opening_origin IS DISTINCT FROM 'MANUAL_CONFIRMATION' THEN
    RETURN NEW;
  END IF;

  IF NEW.ended_by_decision_id IS NOT NULL THEN
    SELECT decision_origin
    INTO ending_origin
    FROM public.project_link_decisions
    WHERE organization_id = NEW.organization_id
      AND id = NEW.ended_by_decision_id;
  ELSE
    SELECT decision.decision_origin
    INTO ending_origin
    FROM public.order_project_links AS replacement
    JOIN public.project_link_decisions AS decision
      ON decision.organization_id = replacement.organization_id
     AND decision.id = replacement.decision_id
    WHERE replacement.organization_id = NEW.organization_id
      AND replacement.order_id = NEW.order_id
      AND replacement.id = NEW.superseded_by_id;
  END IF;

  -- Missing or cross-subject replacement rows remain the responsibility of
  -- the existing deferred foreign-key and chain guards.
  IF ending_origin IS NULL THEN
    RETURN NEW;
  END IF;

  IF ending_origin <> 'MANUAL_CONFIRMATION' THEN
    RAISE EXCEPTION 'order project-link manual precedence violation'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_order_project_links_manual_precedence
AFTER UPDATE ON public.order_project_links
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.assert_order_project_link_manual_precedence();

CREATE FUNCTION public.assert_line_project_link_manual_precedence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  opening_origin text;
  ending_origin text;
BEGIN
  IF OLD.superseded_at IS NOT NULL
    OR NEW.superseded_at IS NULL
  THEN
    RETURN NEW;
  END IF;

  SELECT decision_origin
  INTO opening_origin
  FROM public.project_link_decisions
  WHERE organization_id = OLD.organization_id
    AND id = OLD.decision_id;

  IF opening_origin IS DISTINCT FROM 'MANUAL_CONFIRMATION' THEN
    RETURN NEW;
  END IF;

  IF NEW.ended_by_decision_id IS NOT NULL THEN
    SELECT decision_origin
    INTO ending_origin
    FROM public.project_link_decisions
    WHERE organization_id = NEW.organization_id
      AND id = NEW.ended_by_decision_id;
  ELSE
    SELECT decision.decision_origin
    INTO ending_origin
    FROM public.line_project_links AS replacement
    JOIN public.project_link_decisions AS decision
      ON decision.organization_id = replacement.organization_id
     AND decision.id = replacement.decision_id
    WHERE replacement.organization_id = NEW.organization_id
      AND replacement.line_id = NEW.line_id
      AND replacement.id = NEW.superseded_by_id;
  END IF;

  -- Missing or cross-subject replacement rows remain the responsibility of
  -- the existing deferred foreign-key and chain guards.
  IF ending_origin IS NULL THEN
    RETURN NEW;
  END IF;

  IF ending_origin <> 'MANUAL_CONFIRMATION' THEN
    RAISE EXCEPTION 'line project-link manual precedence violation'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_line_project_links_manual_precedence
AFTER UPDATE ON public.line_project_links
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.assert_line_project_link_manual_precedence();

REVOKE ALL ON FUNCTION public.assert_order_project_link_manual_precedence() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_line_project_link_manual_precedence() FROM PUBLIC;
