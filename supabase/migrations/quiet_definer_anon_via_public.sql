-- The previous lockdown revoked from anon directly, but anon still inherited
-- EXECUTE via the implicit PUBLIC pseudo-role grant. Revoke from PUBLIC and
-- re-grant explicitly to authenticated (moderators are authenticated users).

REVOKE EXECUTE ON FUNCTION public.approve_patch(bigint) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.approve_patch(bigint) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.decline_patch(bigint) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.decline_patch(bigint) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.list_patches(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.list_patches(text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_route_for_review(
  double precision, double precision, double precision, double precision, bigint
) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_route_for_review(
  double precision, double precision, double precision, double precision, bigint
) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_my_role() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_my_role() TO authenticated;
