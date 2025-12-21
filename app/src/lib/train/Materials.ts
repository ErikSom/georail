import { FrontSide, MeshPhysicalMaterial } from "three";

export const glassMaterial = new MeshPhysicalMaterial({
  name: "Train_Glass",
  color: 0xffffff,

  transmission: 1.0,
  transparent: true,
  opacity: 1.0,

  ior: 1.5,
  metalness: 0.0,
  roughness: 0.12,

  thickness: 0.2,
  side: FrontSide,
  depthWrite: false,
});