// In-memory cache of rail chunks. Loads each cell at most once, dedupes
// concurrent requests, and lazily builds the node-id adjacency map used by
// the snap algorithm's happy-path graph walk.

import { fetchRailChunk, type RailChunk, type RailSegment } from './api.ts';
import { cellForPoint, cellsCoveringBBox } from './geom.ts';

export interface ChunkStoreOptions {
    country?: string;
    fetch?: typeof fetchRailChunk;     // injectable for tests
}

function cellKey(cell: { lon: number; lat: number }): string {
    return `${cell.lon}_${cell.lat}`;
}

export class ChunkStore {
    private country: string;
    private fetchChunk: typeof fetchRailChunk;
    private chunks = new Map<string, RailChunk>();
    private inflight = new Map<string, Promise<RailChunk | null>>();
    private segmentIndex = new Map<number, RailSegment>();
    private adjacencyMap = new Map<number, Set<number>>();
    private adjacencyVersion = 0;
    private builtAdjacencyVersion = -1;

    constructor(options: ChunkStoreOptions = {}) {
        this.country = options.country || 'NL';
        this.fetchChunk = options.fetch || fetchRailChunk;
    }

    public size(): number {
        return this.segmentIndex.size;
    }

    public version(): number {
        return this.adjacencyVersion;
    }

    public chunkCount(): number {
        return this.chunks.size;
    }

    public loadedChunks(): IterableIterator<RailChunk> {
        return this.chunks.values();
    }

    public segments(): IterableIterator<RailSegment> {
        return this.segmentIndex.values();
    }

    public segmentById(id: number): RailSegment | undefined {
        return this.segmentIndex.get(id);
    }

    public async ensureChunk(cell: { lon: number; lat: number }, signal?: AbortSignal): Promise<RailChunk | null> {
        const key = cellKey(cell);
        const cached = this.chunks.get(key);
        if (cached) return cached;
        const pending = this.inflight.get(key);
        if (pending) return pending;

        const promise = (async () => {
            try {
                const chunk = await this.fetchChunk(cell, this.country, { signal });
                this.absorb(chunk);
                return chunk;
            } catch (err) {
                if ((err as any)?.name !== 'AbortError') {
                    console.warn('[chunkStore] failed to load cell', cell, err);
                }
                return null;
            } finally {
                this.inflight.delete(key);
            }
        })();
        this.inflight.set(key, promise);
        return promise;
    }

    public async ensureCellsCoveringBBox(
        lonMin: number, latMin: number, lonMax: number, latMax: number,
        signal?: AbortSignal,
    ): Promise<RailChunk[]> {
        const cells = cellsCoveringBBox(lonMin, latMin, lonMax, latMax);
        const results = await Promise.all(cells.map(cell => this.ensureChunk(cell, signal)));
        return results.filter((c): c is RailChunk => c !== null);
    }

    public async ensureCellsAroundPoint(
        lon: number, lat: number, paddingDeg = 0.05, signal?: AbortSignal,
    ): Promise<RailChunk[]> {
        return this.ensureCellsCoveringBBox(lon - paddingDeg, lat - paddingDeg, lon + paddingDeg, lat + paddingDeg, signal);
    }

    public hasCellForPoint(lon: number, lat: number): boolean {
        return this.chunks.has(cellKey(cellForPoint(lon, lat)));
    }

    // Adjacency: nodeId → set of segmentIds that touch that node. Built
    // once after the segment set changes and reused until the next change.
    public adjacency(): Map<number, Set<number>> {
        if (this.builtAdjacencyVersion === this.adjacencyVersion) {
            return this.adjacencyMap;
        }
        this.adjacencyMap.clear();
        for (const seg of this.segmentIndex.values()) {
            this.touchAdjacency(seg);
        }
        this.builtAdjacencyVersion = this.adjacencyVersion;
        return this.adjacencyMap;
    }

    private absorb(chunk: RailChunk): void {
        this.chunks.set(cellKey(chunk.cell), chunk);
        let changed = false;
        for (const segment of chunk.segments || []) {
            if (!this.segmentIndex.has(segment.id)) {
                this.segmentIndex.set(segment.id, segment);
                changed = true;
            }
        }
        if (changed) this.adjacencyVersion++;
    }

    private touchAdjacency(seg: RailSegment): void {
        for (const node of [seg.source, seg.target]) {
            if (node == null) continue;
            let bucket = this.adjacencyMap.get(node);
            if (!bucket) {
                bucket = new Set();
                this.adjacencyMap.set(node, bucket);
            }
            bucket.add(seg.id);
        }
    }
}
