import { useState, useEffect } from 'preact/hooks';

interface Props {
    ready: boolean;
    onDone: () => void;
}

export default function SplashOverlay({ ready, onDone }: Props) {
    const [minTimePassed, setMinTimePassed] = useState(false);
    const [done, setDone] = useState(false);

    useEffect(() => {
        const timer = setTimeout(() => setMinTimePassed(true), 600);
        return () => clearTimeout(timer);
    }, []);

    useEffect(() => {
        if (!ready || !minTimePassed) return;

        const splash = document.getElementById('splash');
        if (!splash) {
            setDone(true);
            return;
        }

        // Fade out the logo first
        const logo = splash.querySelector('img');
        if (logo) {
            logo.style.transition = 'transform 0.5s ease, opacity 0.4s ease';
            logo.style.opacity = '0';
            logo.style.transform = 'scale(1.1)';
        }

        // Then fade out the overlay
        setTimeout(() => {
            splash.style.transition = 'opacity 0.6s ease';
            splash.style.opacity = '0';
            splash.style.pointerEvents = 'none';
        }, 300);

        // Remove from DOM
        setTimeout(() => {
            splash.remove();
            setDone(true);
        }, 1000);
    }, [ready, minTimePassed]);

    useEffect(() => {
        if (done) onDone();
    }, [done]);

    return null;
}
