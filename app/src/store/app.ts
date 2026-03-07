import { signal } from "@preact/signals";

export type AppScreen = 'menu' | 'game';

export const appScreen = signal<AppScreen>('menu');
