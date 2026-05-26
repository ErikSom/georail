/**
 * Performance configuration presets for the application
 */

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

    tier?: 'ultra' | 'high' | 'medium' | 'low' | 'potato';
}

const MB = 1024 * 1024;

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
        tilesCacheMinBytes: 300 * MB,
        tilesCacheMaxBytes: 400 * MB,
        tilesDownloadJobs: 16,
        tilesParseJobs: 4,
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
        tilesCacheMinBytes: 220 * MB,
        tilesCacheMaxBytes: 320 * MB,
        tilesDownloadJobs: 8,
        tilesParseJobs: 2,
        tier: 'low',
    } as PerformanceConfig,

    /**
     * Potato mode - Maximum performance
     */
    POTATO: {
        pixelRatio: 1,
        antialias: false,
        farPlane: 1e7,
        tilesErrorTarget: 50,
        tilesMaxDepth: 18, // Strict limit for potato mode
        tilesCacheMinBytes: 80 * MB,
        tilesCacheMaxBytes: 120 * MB,
        tilesDownloadJobs: 4,
        tilesParseJobs: 1,
        tier: 'potato',
    } as PerformanceConfig,
};

/**
 * Auto-detect appropriate performance preset based on device capabilities
 */
export function detectPerformancePreset(): PerformanceConfig {
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
        return PERFORMANCE_PRESETS.POTATO;
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
    const urlParams = new URLSearchParams(window.location.search);
    const perfParam = urlParams.get('perf')?.toLowerCase();

    switch (perfParam) {
        case 'ultra':
            return PERFORMANCE_PRESETS.ULTRA;
        case 'high':
            return PERFORMANCE_PRESETS.HIGH;
        case 'medium':
            return PERFORMANCE_PRESETS.MEDIUM;
        case 'low':
            return PERFORMANCE_PRESETS.LOW;
        case 'potato':
            return PERFORMANCE_PRESETS.POTATO;
        default:
            return detectPerformancePreset();
    }
}
