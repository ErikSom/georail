import { useEffect } from 'preact/hooks';
import type { Session } from '@supabase/supabase-js';
import type { UserProfile } from '../lib/api/profile';
import type { TabId } from './BottomTabs';
import TravelPicker from './TravelPicker';
import GateScreen from './GateScreen';
import AccountScreen from './AccountScreen';
import styles from './MenuScreen.module.css';

interface Props {
    session: Session | null;
    profile: UserProfile | null;
    checking: boolean;
    activeTab: TabId;
    onLogout: () => void;
    onPremiumChange: () => void;
}

export default function MenuScreen({ session, profile, checking, activeTab, onLogout, onPremiumChange }: Props) {
    useEffect(() => {
        document.body.style.touchAction = 'auto';
        return () => {
            document.body.style.touchAction = '';
        };
    }, []);

    const isPremium = session && !checking && profile?.is_premium;

    const renderPanel = () => {
        // Loading or not logged in
        if (checking || !session) {
            return <GateScreen checking={checking} />;
        }

        // Not premium — show subscribe (via AccountScreen)
        if (!isPremium) {
            return <AccountScreen session={session} onLogout={onLogout} onPremiumChange={onPremiumChange} />;
        }

        // Premium — show active tab content
        if (activeTab === 'account') {
            return <AccountScreen session={session} onLogout={onLogout} onPremiumChange={onPremiumChange} />;
        }

        return <TravelPicker />;
    };

    return (
        <div className={styles.screen}>
            <div className={styles.background} />
            <div className={styles.logoWrapper}>
                <div className={styles.trapezoid} />
                <img src="/logo.svg" alt="Georail" className={styles.logo} />
            </div>
            {renderPanel()}
            <footer className={styles.footer}>&copy; 2025 Terminarch Games &middot; v{__APP_VERSION__}</footer>
        </div>
    );
}
