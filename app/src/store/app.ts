import { signal } from "@preact/signals";

export type AppScreen = 'menu' | 'game';

export const appScreen = signal<AppScreen>('menu');

// True once the MapViewer has loaded its initial tile batch (and the game is
// visually "ready to drive"). Used to show the loading overlay in ThreeViewer.
export const gameReady = signal(false);
