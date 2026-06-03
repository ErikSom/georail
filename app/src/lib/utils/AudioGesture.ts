import type { AudioListener } from 'three';

// Browsers block AudioContext autostart until a user gesture. When the page
// loads straight into a route that owns an AudioListener (e.g. /train-editor)
// the context starts suspended and Three.js Audio.play() silently fails.
// Install a one-shot gesture listener that resumes the context.
export function resumeAudioContextOnGesture(listener: AudioListener): void {
    const ctx = listener.context;
    if (ctx.state === 'running') return;

    const events: (keyof DocumentEventMap)[] = ['pointerdown', 'keydown', 'touchstart'];
    const handler = () => {
        ctx.resume().catch(() => { });
        for (const ev of events) document.removeEventListener(ev, handler);
    };
    for (const ev of events) document.addEventListener(ev, handler);
}
