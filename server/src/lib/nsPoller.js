import axios from 'axios';
import { liveTrainStore } from './liveTrainStore.js';

// Thin NS vehicle-position forwarder. It stores raw positions in the
// in-memory live store; snapping/routing/interpolation happens client-side
// after the relevant rail chunks are loaded.

const NS_VEHICLES_URL = 'https://gateway.apiportal.ns.nl/virtual-train-api/api/vehicle';
const DEFAULT_INTERVAL_MS = 15_000;
const BACKOFF_STEPS_MS = [5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000];

function normalizeBearing(value) {
    if (!Number.isFinite(value)) return undefined;
    const b = Number(value) % 360;
    return b < 0 ? b + 360 : b;
}

function normalizeNsTrain(t, ts = Date.now()) {
    const ritId = t?.ritId ?? t?.ritnummer ?? t?.treinNummer;
    const lon = Number(t?.lng);
    const lat = Number(t?.lat);
    if (!ritId || !Number.isFinite(lon) || !Number.isFinite(lat)) {
        return null;
    }

    const speedKmh = Number(t?.snelheid);
    const speedMs = Number.isFinite(speedKmh) ? Math.max(0, speedKmh / 3.6) : undefined;
    const bearingDeg = normalizeBearing(Number(t?.richting));

    return {
        id: `ns:${ritId}`,
        source: 'ns',
        lon,
        lat,
        ts,
        speedMs,
        bearingDeg,
        meta: {
            ritId,
            treinNummer: t?.treinNummer,
            type: t?.type,
        },
    };
}

export function createNsPoller(options = {}) {
    const store = options.store || liveTrainStore;
    const configuredIntervalMs = options.intervalMs;
    const logger = options.logger || console;
    const fetchVehicles = options.fetchVehicles || (async () => {
        const response = await axios.get(NS_VEHICLES_URL, {
            headers: {
                'Ocp-Apim-Subscription-Key': process.env.NS_API_KEY,
            },
            timeout: 12_000,
        });
        return response.data?.payload?.treinen || [];
    });

    let running = false;
    let inflight = false;
    let timer = null;
    let pruneTimer = null;
    let backoffIndex = -1;
    let lastSuccessfulFetchAt = 0;
    let upstreamCalls = 0;
    let skippedPolls = 0;
    let lastTickStats = null;

    function status() {
        return {
            running,
            inflight,
            lastSuccessfulFetchAt,
            stale: !lastSuccessfulFetchAt || Date.now() - lastSuccessfulFetchAt > 60_000,
            upstreamCalls,
            skippedPolls,
            currentBackoffMs: backoffIndex >= 0 ? BACKOFF_STEPS_MS[backoffIndex] : 0,
            lastTickStats,
            intervalMs: getIntervalMs(),
        };
    }

    function getIntervalMs() {
        const value = Number(configuredIntervalMs || process.env.NS_POLL_INTERVAL_MS || DEFAULT_INTERVAL_MS);
        return Number.isFinite(value) && value > 0 ? value : DEFAULT_INTERVAL_MS;
    }

    function schedule(delayMs) {
        if (!running) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            pollOnce().catch(err => logger.error('[nsPoller] unhandled poll error:', err));
        }, delayMs);
    }

    async function pollOnce() {
        if (inflight) {
            skippedPolls++;
            logger.warn('[nsPoller] previous poll still running; skipping tick');
            return { skipped: true };
        }

        inflight = true;
        const startedAt = Date.now();

        try {
            upstreamCalls++;
            const rawPayload = await fetchVehicles();
            const fetchedAt = Date.now();
            const rawTrains = rawPayload.map(train => normalizeNsTrain(train, fetchedAt)).filter(Boolean);

            let changed = 0;
            for (const raw of rawTrains) {
                const result = store.upsert(raw);
                if (result.changed) changed++;
            }

            lastSuccessfulFetchAt = Date.now();
            backoffIndex = -1;
            lastTickStats = {
                total: rawTrains.length,
                changed,
                durationMs: Date.now() - startedAt,
                fetchedAt: lastSuccessfulFetchAt,
            };
            logger.info(
                `[nsPoller] forwarded ${rawTrains.length} trains (${changed} changed) ` +
                `in ${lastTickStats.durationMs}ms`
            );

            schedule(getIntervalMs());
            return { skipped: false, ok: true, ...lastTickStats };
        } catch (err) {
            backoffIndex = Math.min(backoffIndex + 1, BACKOFF_STEPS_MS.length - 1);
            const delay = BACKOFF_STEPS_MS[backoffIndex];
            logger.error('[nsPoller] upstream fetch failed:', err.message || err, `backoff=${delay}ms`);
            schedule(delay);
            return { skipped: false, ok: false, error: err, backoffMs: delay };
        } finally {
            inflight = false;
        }
    }

    function start() {
        if (running) return;
        running = true;
        logger.info(`[nsPoller] started, interval ${getIntervalMs()}ms`);
        pruneTimer = setInterval(() => {
            const pruned = store.prune();
            if (pruned > 0) logger.info(`[liveTrainStore] pruned ${pruned} entries`);
        }, 60_000);
        schedule(0);
    }

    function stop() {
        running = false;
        if (timer) clearTimeout(timer);
        if (pruneTimer) clearInterval(pruneTimer);
        timer = null;
        pruneTimer = null;
    }

    return {
        start,
        stop,
        pollOnce,
        status,
    };
}

export const nsPoller = createNsPoller();

export const __private = {
    normalizeNsTrain,
};
