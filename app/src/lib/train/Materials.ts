import { FrontSide, MeshStandardMaterial } from "three";

export const glassMaterial = new MeshStandardMaterial({
    name: "Train_Glass",
    color: 0x88ccff,

    transparent: true,
    opacity: 0.3,

    metalness: 0.1,
    roughness: 0.05,

    side: FrontSide,
    depthWrite: false,
});
