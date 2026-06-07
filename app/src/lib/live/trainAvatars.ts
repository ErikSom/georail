export const TRAIN_AVATAR_FAMILIES = [
    'DDZ',
    'Flirt',
    'GTW',
    'ICM',
    'ICNG',
    'SLT',
    'SNG',
    'VIRM',
] as const;

export type TrainAvatarFamily = typeof TRAIN_AVATAR_FAMILIES[number];

const FAMILY_BY_UPPER = new Map<string, TrainAvatarFamily>(
    TRAIN_AVATAR_FAMILIES.map(family => [family.toUpperCase(), family]),
);

export function trainAvatarFamily(type: string | null | undefined): TrainAvatarFamily | null {
    const normalized = type?.trim();
    if (!normalized) return null;

    const upper = normalized.toUpperCase();
    for (const [prefix, family] of FAMILY_BY_UPPER) {
        if (upper === prefix || upper.startsWith(`${prefix} `) || upper.startsWith(`${prefix}-`)) {
            return family;
        }
    }
    return null;
}

export function trainAvatarUrl(type: string | null | undefined): string | null {
    const family = trainAvatarFamily(type);
    return family ? `/avatars/${family}_100x100.png` : null;
}

export function trainAvatarImageId(type: string | null | undefined): string {
    const family = trainAvatarFamily(type);
    return family ? `train-avatar-${family.toLowerCase()}` : '';
}

export function displayTrainId(id: string): string {
    return id.replace(/^ns:/i, '');
}
