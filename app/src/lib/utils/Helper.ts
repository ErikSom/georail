import { Object3D, Quaternion, Vector3 } from "three";

export const dummy = new Object3D();
dummy.up.set(0, 1, 0);

export const dummyQuad = new Quaternion();

export const dummyVec3 = new Vector3();
export const dummyForward = new Vector3(0, 0, 1);
export const dummyUp = new Vector3(0, 1, 0);