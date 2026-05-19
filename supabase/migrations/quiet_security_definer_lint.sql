-- Quiet the remaining security_definer_function_executable warnings.
-- GeoRail requires auth, so anon never needs EXECUTE on any RPC. Revoke broadly.
-- For authenticated, public-read helpers flip to INVOKER (the tables they touch
-- are already authenticated-readable). Moderator-gated functions stay DEFINER
-- because they need elevated privs for the patch tables.

-- ── Public-read helpers: flip to INVOKER and revoke anon EXECUTE.
ALTER FUNCTION public.find_journey_route(jsonb, boolean) SECURITY INVOKER;
ALTER FUNCTION public.find_open_routes(integer, text, text) SECURITY INVOKER;
ALTER FUNCTION public.get_all_stations_with_tracks(text) SECURITY INVOKER;
ALTER FUNCTION public.get_network_coverage(text) SECURITY INVOKER;
ALTER FUNCTION public.get_rail_in_area(double precision, double precision, double precision, text) SECURITY INVOKER;
ALTER FUNCTION public.get_station_coords_batch(text[], text[], text) SECURITY INVOKER;

REVOKE EXECUTE ON FUNCTION public.find_journey_route(jsonb, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.find_open_routes(integer, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_all_stations_with_tracks(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_network_coverage(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_rail_in_area(double precision, double precision, double precision, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_station_coords_batch(text[], text[], text) FROM anon;

-- ── get_my_role: kept DEFINER (called from RLS policies). Just revoke anon.
REVOKE EXECUTE ON FUNCTION public.get_my_role() FROM anon;

-- ── Moderator-gated: anon never satisfied the IF check anyway. Revoke explicitly.
REVOKE EXECUTE ON FUNCTION public.approve_patch(bigint) FROM anon;
REVOKE EXECUTE ON FUNCTION public.decline_patch(bigint) FROM anon;
REVOKE EXECUTE ON FUNCTION public.list_patches(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_route_for_review(
  double precision, double precision, double precision, double precision, bigint
) FROM anon;
