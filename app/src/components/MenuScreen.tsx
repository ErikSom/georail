import { useEffect } from 'preact/hooks';
import type { Session } from '@supabase/supabase-js';
import type { UserProfile } from '../lib/api/profile';
import type { TabId } from './BottomTabs';
import TravelPicker from './TravelPicker';
import GateScreen from './GateScreen';
import AccountScreen from './AccountScreen';
import CreditsScreen from './CreditsScreen';
import { t } from '../i18n';
import styles from './MenuScreen.module.css';

interface Props {
    session: Session | null;
    profile: UserProfile | null;
    checking: boolean;
    activeTab: TabId;
    recoveryMode: boolean;
    showCredits: boolean;
    onLogout: () => void;
    onPremiumChange: () => void;
    onRecoveryComplete: () => void;
    onOpenCredits: () => void;
    onCloseCredits: () => void;
}

export default function MenuScreen({ session, profile, checking, activeTab, recoveryMode, showCredits, onLogout, onPremiumChange, onRecoveryComplete, onOpenCredits, onCloseCredits }: Props) {
    useEffect(() => {
        document.body.style.touchAction = 'auto';
        return () => {
            document.body.style.touchAction = '';
        };
    }, []);

    const isPremium = session && !checking && profile?.is_premium;

    const renderPanel = () => {
        if (showCredits) {
            return <CreditsScreen onBack={onCloseCredits} />;
        }

        // Password recovery — override everything else
        if (recoveryMode) {
            return <GateScreen checking={false} recoveryMode onRecoveryComplete={onRecoveryComplete} />;
        }

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
                <img src="/logo.svg" alt="GeoRail" className={styles.logo} />
            </div>
            {renderPanel()}
            <footer className={styles.footer}>
                &copy; 2025 Terminarch Games &middot; v{__APP_VERSION__}
                {' · '}
                <button className={styles.creditsLink} onClick={onOpenCredits}>
                    {t('menu.footer.credits')}
                </button>
            </footer>
        </div>
    );
}
