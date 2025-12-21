import { EquirectangularReflectionMapping, FrontSide, MeshPhysicalMaterial } from "three";
import { Pane } from "tweakpane";
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';

export const glassMaterial = new MeshPhysicalMaterial({
    name: "Train_Glass",
    color: 0xffffff,

    transmission: 1.0,
    transparent: true,
    opacity: 1.0,

    ior: 1.5,
    metalness: 0.0,
    roughness: 0.2,

    thickness: 0.0,
    side: FrontSide,
    depthWrite: false,
});


export function loadGlassMaterialEnvMap(envMapUrl: string) {
    new EXRLoader().load(envMapUrl, (texture) => {
        texture.mapping = EquirectangularReflectionMapping;
        glassMaterial.envMap = texture;
        glassMaterial.needsUpdate = true;

        console.log('Loaded environment map for glass material from', envMapUrl);
    });
}

export function addGlassMaterialDebugTweaks() {
    const rootDomContainer = document.getElementById('tweakpane-container');

    const pane = new Pane({ container: rootDomContainer || undefined });
    const folder = pane.addFolder({ title: "Glass Material" });

    folder.addBinding(glassMaterial, "transmission", { min: 0, max: 1, step: 0.01 });
    folder.addBinding(glassMaterial, "opacity", { min: 0, max: 1, step: 0.01 });
    folder.addBinding(glassMaterial, "ior", { min: 1, max: 2.5, step: 0.01 });
    folder.addBinding(glassMaterial, "roughness", { min: 0, max: 1, step: 0.01 });
    folder.addBinding(glassMaterial, "thickness", { min: 0, max: 1, step: 0.01 });
}