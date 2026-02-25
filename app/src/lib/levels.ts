/**
 * Level system for GeoRail
 *
 * Levels are determined by total kilometers driven.
 * Power curve: T(L) = BASE_KM * L^EXPONENT
 *
 * Level 1:      30 km  (30 min)
 * Level 10:    671 km  (~11.2 hours cumulative)
 * Level 50:  5,886 km  (~98 hours cumulative)
 * Level 100: 15,000 km (~250 hours cumulative)
 * Level 300: 66,063 km (~1,101 hours cumulative)
 *
 * No max level — levels scale infinitely.
 */

const BASE_KM = 30;
const EXPONENT = 1.3495;
const INV_EXPONENT = 1 / EXPONENT;

export interface LevelInfo {
    level: number;
    currentKm: number;
    kmForCurrentLevel: number;   // total km needed to reach current level
    kmForNextLevel: number;      // total km needed to reach next level
    progressKm: number;          // km earned within current level bracket
    bracketKm: number;           // km needed for the current bracket
    progressFraction: number;    // 0-1 progress toward next level
}

/** Total km required to reach a given level */
export function kmRequiredForLevel(level: number): number {
    if (level <= 0) return 0;
    return BASE_KM * Math.pow(level, EXPONENT);
}

/** Compute level from total km driven */
export function computeLevel(totalKm: number): number {
    if (totalKm <= 0) return 0;
    // Solve: BASE_KM * L^EXPONENT <= totalKm  =>  L = (totalKm / BASE_KM)^(1/EXPONENT)
    const L = Math.pow(totalKm / BASE_KM, INV_EXPONENT);
    return Math.floor(L);
}

/** Get full level info for display */
export function getLevelInfo(totalKm: number): LevelInfo {
    const level = computeLevel(totalKm);
    const kmForCurrentLevel = kmRequiredForLevel(level);
    const kmForNextLevel = kmRequiredForLevel(level + 1);
    const progressKm = totalKm - kmForCurrentLevel;
    const bracketKm = kmForNextLevel - kmForCurrentLevel;

    return {
        level,
        currentKm: totalKm,
        kmForCurrentLevel,
        kmForNextLevel,
        progressKm,
        bracketKm,
        progressFraction: bracketKm > 0 ? Math.min(1, progressKm / bracketKm) : 0,
    };
}

/** Check if adding km would cause a level up */
export function wouldLevelUp(previousKm: number, addedKm: number): boolean {
    return computeLevel(previousKm + addedKm) > computeLevel(previousKm);
}
