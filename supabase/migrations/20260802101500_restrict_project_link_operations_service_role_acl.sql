-- Forward-only ACL correction for public.project_link_operations.
--
-- Confirmed remote audit: Supabase's default privileges (owned by postgres)
-- granted service_role the full table-privilege set (SELECT, INSERT, UPDATE,
-- DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN) automatically at table
-- creation. The prior migration's GRANT SELECT, INSERT, UPDATE is additive
-- and does not remove those automatically-granted privileges, so service_role
-- currently retains DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN even though
-- only SELECT/INSERT/UPDATE were ever intended.
--
-- This migration revokes every privilege service_role holds on this one
-- table and re-grants exactly the approved contract. It does not touch
-- ALTER DEFAULT PRIVILEGES (so future tables are unaffected), does not touch
-- PUBLIC/anon/authenticated (already correctly revoked), does not change
-- table ownership, role attributes, RLS, triggers, functions, indexes, or
-- constraints.
REVOKE ALL PRIVILEGES
ON TABLE public.project_link_operations
FROM service_role;

GRANT SELECT, INSERT, UPDATE
ON TABLE public.project_link_operations
TO service_role;
