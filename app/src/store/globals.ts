import { signal } from "@preact/signals";
import { AudioListener, PerspectiveCamera } from "three";
import { loadData, saveData } from "../lib/utils/LocalStorage";

/**
 * Global state for Three.js objects that need to be shared across systems
 */

const searchParams = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');

// Screen-size helper (evaluated once at load time)
export const isSmallScreen = typeof window !== 'undefined' && window.innerWidth <= 768;

// Audio listener for positional audio (typically attached to the camera)
export const audioListener = signal<AudioListener | null>(null);

// Main camera reference (optional, for future use)
export const mainCamera = signal<PerspectiveCamera | null>(null);

// Global time scale - multiply all delta times by this value
// 1.0 = normal speed, 2.0 = double speed, 0.5 = half speed
export const timeScale = signal(searchParams.get('timeScale') ? parseFloat(searchParams.get('timeScale')!) : 1.0);

console.log(`Time scale set to ${timeScale.value}`);

// Scaled delta time in seconds - updated by World.ts each frame
// Use this for any time-based calculations that should respect timeScale
export const scaledDeltaTime = signal(0);

// Active country (ISO 3166-1 alpha-2) — settable via ?country= URL param
export const country = signal(searchParams.get('country')?.toUpperCase() || 'NL');

// HUD element visibility — persisted via unified localStorage
export interface HudSettings {
    showMap2D: boolean;
    showSpeedometer: boolean;
    showTransit: boolean;
}

const HUD_DEFAULTS: HudSettings = { showMap2D: true, showSpeedometer: true, showTransit: true };

export const hudSettings = signal<HudSettings>(loadData('hud', HUD_DEFAULTS));

export function setHudSetting<K extends keyof HudSettings>(key: K, value: HudSettings[K]) {
    const next = { ...hudSettings.value, [key]: value };
    hudSettings.value = next;
    saveData('hud', next);
}

interface Configs {
    unitSystem: 'metric' | 'imperial';
    // Dwell time settings (in minutes)
    initialDwellTime: number;      // Dwell time at first stop (used in both regular and custom)
    minStopDwellTime: number;      // Minimum random dwell time at intermediate stops (custom only)
    maxStopDwellTime: number;      // Maximum random dwell time at intermediate stops (custom only)
    // Station stop detection - zone is centered on station, length = train length + this leniency
    stationStopLeniencyM: number;  // Extra meters added to train length for stop zone (default: 15m)
}
export const configs = signal<Configs>({
    unitSystem: 'metric',
    initialDwellTime: 1,
    minStopDwellTime: 1,
    maxStopDwellTime: 6,
    stationStopLeniencyM: 15,
});

// Game conditions — set in TravelPicker, consumed by World/Sky/Rain on journey start
export interface GameConditions {
    timeOfDay: number;        // 0-2400 (military time mapped to sky)
    weather: 'clear' | 'cloudy' | 'overcast' | 'rain' | 'heavy-rain';
}

const GAME_CONDITIONS_DEFAULTS: GameConditions = {
    timeOfDay: -1,  // -1 = use real time
    weather: 'clear',
};

export const gameConditions = signal<GameConditions>(
    loadData('gameConditions', GAME_CONDITIONS_DEFAULTS)
);

export function setGameCondition<K extends keyof GameConditions>(key: K, value: GameConditions[K]) {
    const next = { ...gameConditions.value, [key]: value };
    gameConditions.value = next;
    saveData('gameConditions', next);
}

