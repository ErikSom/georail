import { loadData, saveData } from './LocalStorage';

/**
 * Performance configuration presets for the application
 */

export type PerformanceTier = 'ultra' | 'high' | 'medium' | 'low';
export type PerformancePresetChoice = PerformanceTier | 'auto';

export interface PerformanceConfig {
    pixelRatio: number;
    antialias: boolean;

    farPlane: number;

    tilesErrorTarget: number;
    tilesMaxDepth: number;
    tilesCacheMinBytes: number;
    tilesCacheMaxBytes: number;
    tilesDownloadJobs: number;
    tilesParseJobs: number;
    tilesUpdateIntervalMs: number;

    minimapRaster: boolean;
    minimapWorkerCount: number;

    tier: PerformanceTier;
}

const MB = 1024 * 1024;
const PERFORMANCE_PRESET_STORAGE_KEY = 'performancePreset';

export const PERFORMANCE_PRESET_CHOICES: PerformancePresetChoice[] = ['auto', 'low', 'medium', 'high', 'ultra'];

let cachedPerformanceConfig: PerformanceConfig | null = null;

function isPerformanceTier(value: string | null | undefined): value is PerformanceTier {
    return value === 'ultra' || value === 'high' || value === 'medium' || value === 'low';
}

function isPerformancePresetChoice(value: unknown): value is PerformancePresetChoice {
    return value === 'auto' || isPerformanceTier(typeof value === 'string' ? value : null);
}

export function getStoredPerformancePresetChoice(): PerformancePresetChoice {
    const stored = loadData<unknown>(PERFORMANCE_PRESET_STORAGE_KEY, 'auto');
    return isPerformancePresetChoice(stored) ? stored : 'auto';
}

export function setStoredPerformancePresetChoice(choice: PerformancePresetChoice): void {
    saveData(PERFORMANCE_PRESET_STORAGE_KEY, choice);
    cachedPerformanceConfig = null;
}

function getUrlPerformancePresetChoice(): PerformanceTier | null {
    if (typeof window === 'undefined') return null;
    const urlParams = new URLSearchParams(window.location.search);
    const perfParam = urlParams.get('perf')?.toLowerCase();
    return isPerformanceTier(perfParam) ? perfParam : null;
}

export const PERFORMANCE_PRESETS = {
    /**
     * Maximum quality - Best for high-end desktop GPUs
     */
    ULTRA: {
        pixelRatio: 2,
        antialias: true,
        farPlane: 1e7,
        tilesErrorTarget: 20,
        tilesMaxDepth: Infinity, // No limit - maximum detail
        tilesCacheMinBytes: 300 * MB,
        tilesCacheMaxBytes: 400 * MB,
        tilesDownloadJobs: 25,
        tilesParseJobs: 5,
        tilesUpdateIntervalMs: 16,
        minimapRaster: false,
        minimapWorkerCount: 2,
        tier: 'ultra',

    } as PerformanceConfig,

    /**
     * High quality - Good balance for most systems
     */
    HIGH: {
        pixelRatio: 1.5,
        antialias: true,
        farPlane: 1e7,
        tilesErrorTarget: 20,
        tilesMaxDepth: Infinity, // No limit
        tilesCacheMinBytes: 300 * MB,
        tilesCacheMaxBytes: 400 * MB,
        tilesDownloadJobs: 25,
        tilesParseJobs: 5,
        tilesUpdateIntervalMs: 16,
        minimapRaster: false,
        minimapWorkerCount: 2,
        tier: 'high',
    } as PerformanceConfig,

    /**
     * Medium quality - Recommended default
     */
    MEDIUM: {
        pixelRatio: 1.5,
        antialias: false,
        farPlane: 1e7,
        tilesErrorTarget: 25,
        tilesMaxDepth: Infinity,
        tilesCacheMinBytes: 220 * MB,
        tilesCacheMaxBytes: 320 * MB,
        tilesDownloadJobs: 12,
        tilesParseJobs: 3,
        tilesUpdateIntervalMs: 33,
        minimapRaster: false,
        minimapWorkerCount: 2,
        tier: 'medium',
    } as PerformanceConfig,

    /**
     * Low quality - For mobile or older hardware not used yet
     */
    LOW: {
        pixelRatio: 1,
        antialias: false,
        farPlane: 1e7,
        tilesErrorTarget: 25,
        tilesMaxDepth: Infinity,
        tilesCacheMinBytes: 140 * MB,
        tilesCacheMaxBytes: 220 * MB,
        tilesDownloadJobs: 6,
        tilesParseJobs: 2,
        tilesUpdateIntervalMs: 66,
        minimapRaster: true,
        minimapWorkerCount: 1,
        tier: 'low',
    } as PerformanceConfig,

};

/**
 * Auto-detect appropriate performance preset based on device capabilities
 */
export function detectPerformancePreset(): PerformanceConfig {
    if (typeof window === 'undefined' || typeof document === 'undefined' || typeof navigator === 'undefined') {
        return PERFORMANCE_PRESETS.MEDIUM;
    }

    // Check if mobile
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const isTouchMac = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;

    if (isMobile || isTouchMac) {
        return PERFORMANCE_PRESETS.LOW;
    }

    // Check GPU tier (rough estimation)
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl') as WebGLRenderingContext | null;

    if (!gl) {
        return PERFORMANCE_PRESETS.LOW;
    }

    // Check for high-end GPU features
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    if (debugInfo) {
        const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
        console.log('GPU:', renderer);

        // High-end GPUs
        if (/RTX|RX 6|RX 7|M1|M2|M3/i.test(renderer)) {
            return PERFORMANCE_PRESETS.HIGH;
        }

        // Integrated GPUs
        if (/Intel|UHD|Iris/i.test(renderer)) {
            return PERFORMANCE_PRESETS.LOW;
        }
    }

    // Default to MEDIUM
    return PERFORMANCE_PRESETS.MEDIUM;
}

/**
 * Get performance config from URL parameter or auto-detect
 * Usage: ?perf=low or ?perf=high
 */
export function getPerformanceConfig(): PerformanceConfig {
    if (cachedPerformanceConfig) return cachedPerformanceConfig;

    const presetChoice = getUrlPerformancePresetChoice() ?? getStoredPerformancePresetChoice();

    switch (presetChoice) {
        case 'ultra':
            cachedPerformanceConfig = PERFORMANCE_PRESETS.ULTRA;
            return cachedPerformanceConfig;
        case 'high':
            cachedPerformanceConfig = PERFORMANCE_PRESETS.HIGH;
            return cachedPerformanceConfig;
        case 'medium':
            cachedPerformanceConfig = PERFORMANCE_PRESETS.MEDIUM;
            return cachedPerformanceConfig;
        case 'low':
            cachedPerformanceConfig = PERFORMANCE_PRESETS.LOW;
            return cachedPerformanceConfig;
        default:
            cachedPerformanceConfig = detectPerformancePreset();
            return cachedPerformanceConfig;
    }
}
