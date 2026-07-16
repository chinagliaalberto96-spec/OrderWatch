CREATE OR REPLACE FUNCTION public.find_contact_matches(
  p_organization_id uuid,
  p_name text,
  p_threshold numeric DEFAULT 0.76,
  p_limit integer DEFAULT 5
)
RETURNS TABLE(contact_id uuid, legal_name text, contact_type text, score numeric, match_source text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
  WITH input AS (
    SELECT public.normalize_contact_name(p_name) AS normalized
  ), candidates AS (
    SELECT c.id, c.legal_name, c.type,
      extensions.similarity(c.normalized_name, input.normalized)::numeric AS score,
      'legal_name'::text AS match_source
    FROM public.contacts c CROSS JOIN input
    WHERE c.organization_id = p_organization_id AND c.status = 'active'
      AND extensions.similarity(c.normalized_name, input.normalized) >= p_threshold
    UNION ALL
    SELECT c.id, c.legal_name, c.type,
      extensions.similarity(a.normalized_alias, input.normalized)::numeric AS score,
      'alias'::text AS match_source
    FROM public.contact_aliases a
    JOIN public.contacts c ON c.id = a.contact_id AND c.organization_id = a.organization_id
    CROSS JOIN input
    WHERE a.organization_id = p_organization_id AND c.status = 'active'
      AND extensions.similarity(a.normalized_alias, input.normalized) >= p_threshold
  )
  SELECT ranked.id, ranked.legal_name, ranked.type, ranked.score, ranked.match_source
  FROM (
    SELECT DISTINCT ON (id) id, legal_name, type, score, match_source
    FROM candidates
    ORDER BY id, score DESC
  ) ranked
  ORDER BY ranked.score DESC, ranked.legal_name ASC
  LIMIT greatest(1, least(coalesce(p_limit, 5), 20));
$$;
REVOKE ALL ON FUNCTION public.find_contact_matches(uuid,text,numeric,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_contact_matches(uuid,text,numeric,integer) TO service_role;
