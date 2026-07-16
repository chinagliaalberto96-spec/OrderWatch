-- 1) Sequence atomica per i Project Code (sostituisce la generazione basata sul conteggio righe,
--    che poteva produrre codici duplicati dopo una cancellazione — stessa famiglia del bug LAV-35 del pilota).
--    Inizializzata a 36 perche' il contatore del pilota Make e' a 37 (max codice esistente = LAV-36):
--    il prossimo nextval() restituisce 37, nessuna collisione con i codici del pilota in caso di migrazione dati.
CREATE SEQUENCE IF NOT EXISTS public.project_code_seq;
SELECT setval('public.project_code_seq', GREATEST(
  COALESCE((SELECT MAX(NULLIF(regexp_replace(project_code, '\D', '', 'g'), '')::bigint) FROM public.projects), 0),
  36
));

CREATE OR REPLACE FUNCTION public.next_project_code()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 'LAV-' || nextval('public.project_code_seq')::text;
$$;

-- Solo il backend (service_role) puo' generare codici; nessun accesso da anon/authenticated.
REVOKE ALL ON FUNCTION public.next_project_code() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_project_code() TO service_role;
REVOKE ALL ON SEQUENCE public.project_code_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SEQUENCE public.project_code_seq TO service_role;

-- 2) Trigger updated_at: garantisce il timestamp anche se un client dimentica di impostarlo.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'updated_at'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_set_updated_at ON public.%I', t);
    EXECUTE format('CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()', t);
  END LOOP;
END;
$$;
