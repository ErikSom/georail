import { signal, effect } from "@preact/signals";

const STORAGE_KEY = "georail_map2d_state";
const isBrowser = typeof window !== "undefined";

interface Map2DState {
    x: number;
    y: number;
    size: number;
}

const DEFAULT_STATE: Map2DState = { x: 100, y: 100, size: 200 };

function loadState(): Map2DState {
    if (!isBrowser) return DEFAULT_STATE;
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            // Handle migration from old format with width/height
            if (parsed.width && !parsed.size) {
                return { x: parsed.x ?? 100, y: parsed.y ?? 100, size: parsed.width };
            }
            // Validate the parsed data has required fields
            if (typeof parsed.x === 'number' && typeof parsed.y === 'number' && typeof parsed.size === 'number') {
                // Ensure size is at least MIN_SIZE (100)
                return {
                    x: parsed.x,
                    y: parsed.y,
                    size: Math.max(100, parsed.size),
                };
            }
        }
    } catch {
        // Ignore parse errors
    }
    return DEFAULT_STATE;
}

const initial = loadState();

export const mapPosition = signal({ x: initial.x, y: initial.y });
export const mapSize = signal(initial.size);
export const mapSelected = signal(false);

// Initialize from localStorage on client (handles hydration mismatch)
export function initializeMapState() {
    const state = loadState();
    mapPosition.value = { x: state.x, y: state.y };
    mapSize.value = state.size;
}

// Persist state to localStorage
if (isBrowser) {
    effect(() => {
        const state: Map2DState = {
            ...mapPosition.value,
            size: mapSize.value,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    });
}
