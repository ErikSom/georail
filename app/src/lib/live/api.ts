// Thin wrappers around the two server endpoints. The server is now a dumb
// passthrough — all snap + interpolation logic lives in the client.

// Resolved lazily so this file is importable from node tests that don't
// run under Astro/Vite (where import.meta.env is defined).
function apiBase(): string {
    // @ts-ignore — import.meta.env is provided by Astro/Vite at build time.
    const env = typeof import.meta !== 'undefined' ? (import.meta as any).env : undefined;
    return env?.PUBLIC_GEORAIL_URL ?? '';
}

export interface RawPosition {
    t: number;          // ms since epoch
    lon: number;
    lat: number;
    spd?: number;       // m/s
    brg?: number;       // degrees
}

export interface LiveTrainSummary {
    id: string;
    s: 'ns' | 'p';
    meta: Record<string, unknown>;
    seq: number;
    recent: RawPosition[];  // oldest-first, up to 5 latest snapshots
}

export interface LivePositionsResponse {
    fetchedAt: number;
    stale: boolean;
    trains: LiveTrainSummary[];
}

export interface LiveTrainConsistPart {
    materialNumber: number | null;
    type: string | null;
    carCount: number;
    facilities: string[];
    image: string | null;
    imageWidth: number | null;
    imageHeight: number | null;
}

export interface LiveTrainConsist {
    ritnummer: string;
    type: string | null;
    source: string | null;
    carrier: string | null;
    station: string | null;
    track: string | null;
    shortened: boolean;
    carCount: number;
    lengthM: number | null;
    parts: LiveTrainConsistPart[];
}

export interface LiveConsistsResponse {
    fetchedAt: number;
    consists: Record<string, LiveTrainConsist | null>;
}

export interface RailSegment {
    id: number;
    source: number | null;
    target: number | null;
    lengthM: number;
    geom: [number, number][];                       // [lon, lat] vertices
    worldOffsets: [number, number, number][];       // per-vertex, may be empty
}

export interface RailChunk {
    cell: { lon: number; lat: number };
    bounds: { lonMin: number; latMin: number; lonMax: number; latMax: number };
    country: string;
    segments: RailSegment[];
}

export interface FetchLivePositionsArgs {
    all?: boolean;
    bbox?: { lonMin: number; latMin: number; lonMax: number; latMax: number };
}

function assertOk(res: Response, label: string): void {
    if (!res.ok) throw new Error(`${label} failed: ${res.status}`);
}

export async function fetchLivePositions(
    args: FetchLivePositionsArgs,
    options: { signal?: AbortSignal } = {}
): Promise<LivePositionsResponse> {
    const params = new URLSearchParams();
    if (args.all) {
        params.set('all', '1');
    } else if (args.bbox) {
        const { lonMin, latMin, lonMax, latMax } = args.bbox;
        params.set('bbox', `${lonMin},${latMin},${lonMax},${latMax}`);
    } else {
        throw new Error('fetchLivePositions requires all=1 or bbox');
    }
    const res = await fetch(`${apiBase()}/live-positions?${params.toString()}`, { signal: options.signal });
    assertOk(res, 'live positions fetch');
    return res.json();
}

export async function fetchLiveConsists(
    ids: string[],
    options: { signal?: AbortSignal } = {}
): Promise<LiveConsistsResponse> {
    const cleanIds = [...new Set(ids.map(id => String(id).replace(/^ns:/i, '').trim()).filter(Boolean))];
    if (cleanIds.length === 0) return { fetchedAt: Date.now(), consists: {} };

    const params = new URLSearchParams({ ids: cleanIds.join(',') });
    const res = await fetch(`${apiBase()}/live-positions/consists?${params.toString()}`, { signal: options.signal });
    assertOk(res, 'live train consists fetch');
    return res.json();
}

export async function fetchRailChunk(
    cell: { lon: number; lat: number },
    country: string = 'NL',
    options: { signal?: AbortSignal } = {}
): Promise<RailChunk> {
    const params = new URLSearchParams({ country });
    const res = await fetch(`${apiBase()}/rail-chunks/${cell.lon}/${cell.lat}?${params.toString()}`, { signal: options.signal });
    assertOk(res, 'rail chunk fetch');
    return res.json();
}
