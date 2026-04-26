import { t } from '../i18n';
import styles from './BottomTabs.module.css';

export type TabId = 'journey' | 'account';

interface Props {
    activeTab: TabId;
    onTabChange: (tab: TabId) => void;
}

export default function BottomTabs({ activeTab, onTabChange }: Props) {
    return (
        <nav className={styles.tabs}>
            <button
                className={`${styles.tab} ${activeTab === 'journey' ? styles.active : ''}`}
                onClick={() => onTabChange('journey')}
            >
                <span className={styles.icon} style={{ maskImage: 'url(/icons/journey.svg)', WebkitMaskImage: 'url(/icons/journey.svg)' }} />
                <span className={styles.label}>{t('tabs.journey')}</span>
            </button>
            <button
                className={`${styles.tab} ${activeTab === 'account' ? styles.active : ''}`}
                onClick={() => onTabChange('account')}
            >
                <span className={styles.icon} style={{ maskImage: 'url(/icons/account.svg)', WebkitMaskImage: 'url(/icons/account.svg)' }} />
                <span className={styles.label}>{t('tabs.account')}</span>
            </button>
        </nav>
    );
}
