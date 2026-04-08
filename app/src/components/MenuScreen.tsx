import { useEffect } from 'preact/hooks';
import type { Session } from '@supabase/supabase-js';
import type { UserProfile } from '../lib/api/profile';
import TravelPicker from './TravelPicker';
import GateScreen from './GateScreen';
import styles from './MenuScreen.module.css';

interface Props {
    session: Session | null;
    profile: UserProfile | null;
    checking: boolean;
    onLogout: () => void;
}

export default function MenuScreen({ session, profile, checking, onLogout }: Props) {
    useEffect(() => {
        document.body.style.touchAction = 'auto';
        return () => {
            document.body.style.touchAction = '';
        };
    }, []);

    const showGame = session && !checking && profile?.is_premium;

    return (
        <div className={styles.screen}>
            <div className={styles.background} />
            <div className={styles.logoWrapper}>
                <div className={styles.trapezoid} />
                <img src="/logo.svg" alt="Georail" className={styles.logo} />
            </div>
            {showGame
                ? <TravelPicker />
                : <GateScreen session={session} checking={checking} onLogout={onLogout} />
            }
            <footer className={styles.footer}>&copy; 2025 Terminarch Games</footer>
        </div>
    );
}
