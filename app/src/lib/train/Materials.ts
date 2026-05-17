import { FrontSide, MeshStandardMaterial } from "three";

const baseGlassParams = {
    color: 0xffffff,
    transparent: true,
    opacity: 0.3,
    metalness: 0.1,
    roughness: 0.05,
    side: FrontSide,
    depthWrite: false,
} as const;

// Bundled (internal) trains run applyDeobfuscation, which mutates
// onBeforeCompile on every material it walks. Keep a separate singleton for
// user-provided trains so the warp shader can never leak across them.
export const glassMaterialInternal = new MeshStandardMaterial({
    name: "Train_Glass_Internal",
    ...baseGlassParams,
});

export const glassMaterialPlain = new MeshStandardMaterial({
    name: "Train_Glass_Plain",
    ...baseGlassParams,
});

export function getGlassMaterial(isInternal: boolean): MeshStandardMaterial {
    return isInternal ? glassMaterialInternal : glassMaterialPlain;
}
