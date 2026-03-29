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
                <svg className={styles.icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
                </svg>
                <span className={styles.label}>Journey</span>
            </button>
            <button
                className={`${styles.tab} ${activeTab === 'account' ? styles.active : ''}`}
                onClick={() => onTabChange('account')}
            >
                <svg className={styles.icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                </svg>
                <span className={styles.label}>Account</span>
            </button>
        </nav>
    );
}
