/**
 * Rank names for GeoRail levels
 *
 * Every level from 1 to 100 has its own rank name (i18n `ranks.names.<level>`),
 * grouped into ten tiers of ten levels (i18n `ranks.tiers.<id>`). Level 100 is
 * the top rank: higher levels keep its name, and level 0 (before the first
 * 30 km) shares level 1's name.
 */

import { t } from '../i18n';

const MAX_RANK_LEVEL = 100;
const LEVELS_PER_TIER = 10;

const RANK_TIERS = [
    { id: 'starter', color: '#6b7280' },
    { id: 'rookie', color: '#a0612a' },
    { id: 'driver', color: '#15803d' },
    { id: 'pro', color: '#2563eb' },
    { id: 'expert', color: '#0f766e' },
    { id: 'master', color: '#4f46e5' },
    { id: 'epic', color: '#9333ea' },
    { id: 'legendary', color: '#c2410c' },
    { id: 'mythic', color: '#dc2626' },
    { id: 'ultimate', color: '#b8860b' },
] as const;

export interface Rank {
    name: string;
    tier: string;          // translated tier name
    tierId: string;
    color: string;         // tier color, readable behind white text
    isTopTier: boolean;
}

/** Rank for a level (clamped to 1–100) */
export function getRank(level: number): Rank {
    const l = Math.min(MAX_RANK_LEVEL, Math.max(1, Math.floor(level)));
    const tierIndex = Math.floor((l - 1) / LEVELS_PER_TIER);
    const tier = RANK_TIERS[tierIndex];

    return {
        name: t(`ranks.names.${l}`),
        tier: t(`ranks.tiers.${tier.id}`),
        tierId: tier.id,
        color: tier.color,
        isTopTier: tierIndex === RANK_TIERS.length - 1,
    };
}
