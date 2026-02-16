/**
 * Level system for GeoRail
 *
 * Levels are determined by total kilometers driven.
 * Uses triangular numbers: Level N requires BASE_KM * N * (N + 1) / 2 total km.
 *
 * Level 1:    50 km
 * Level 2:   150 km  (+100)
 * Level 3:   300 km  (+150)
 * Level 4:   500 km  (+200)
 * Level 5:   750 km  (+250)
 * Level 10: 2750 km
 * Level 20: 10500 km
 *
 * No max level — levels scale infinitely.
 */

const BASE_KM = 50;

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
    return BASE_KM * level * (level + 1) / 2;
}

/** Compute level from total km driven */
export function computeLevel(totalKm: number): number {
    if (totalKm <= 0) return 0;
    // Solve: BASE_KM * L * (L+1) / 2 <= totalKm
    const L = (-1 + Math.sqrt(1 + 8 * totalKm / BASE_KM)) / 2;
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
