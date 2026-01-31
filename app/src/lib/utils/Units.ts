// Unit conversion constants and utilities

export const KMH_TO_MPH = 0.62137;
export const MPH_TO_KMH = 1.60934;

export function kmhToMph(kmh: number): number {
    return kmh * KMH_TO_MPH;
}

export function mphToKmh(mph: number): number {
    return mph * MPH_TO_KMH;
}

export function formatSpeed(speedKmh: number, unitSystem: 'metric' | 'imperial'): number {
    if (unitSystem === 'imperial') {
        return Math.round(speedKmh * KMH_TO_MPH);
    }
    return Math.round(speedKmh);
}

export function getSpeedUnit(unitSystem: 'metric' | 'imperial'): string {
    return unitSystem === 'metric' ? 'km/h' : 'mph';
}
