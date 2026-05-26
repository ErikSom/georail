# GeoRail Server Notes

## Live train overlay limitation

The live train store is intentionally in-memory and process-local. Running more
than one server instance gives each instance its own NS poller and its own live
state. Before scaling horizontally, move this state to Redis/Postgres or elect a
single poller instance.

## Live train production notes

- `NS_API_KEY` is required for the NS vehicle-position feed and the Virtual
  Train consist lookup.
- Keep `NS_POLL_INTERVAL_MS` conservative unless the NS quota and observed
  refresh cadence justify faster polling. Client-side interpolation is expected
  to provide smooth motion.
- `/live-positions/consists` is cached in-process and coalesces concurrent
  misses. If the API server is scaled horizontally, move this cache to shared
  storage or accept one upstream consist lookup per instance.
- `/rail-chunks` is cacheable read-only geometry. Put a CDN in front of it for
  production; rail chunks should have high cache hit rates.
- The `/debug/live-trains` frontend page is a development/reference tool. Do
  not expose it in a public production build unless you deliberately want users
  to inspect the live overlay internals.
