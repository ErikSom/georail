import { pendingDoorOpen } from '../../store/journey';
import { trainControlsOpen } from '../../store/train';
import { t } from '../../i18n';
import styles from './DoorPrompt.module.css';

export default function DoorPrompt() {
    if (!pendingDoorOpen.value) return null;
    const positionClass = trainControlsOpen.value ? styles.aboveControls : styles.aboveAttribution;
    return (
        <div className={`${styles.prompt} ${positionClass}`}>
            <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
                <path
                    d="M12 2 L22 21 L2 21 Z"
                    fill="#f59e0b"
                    stroke="#7c2d12"
                    strokeWidth="1.4"
                    strokeLinejoin="round"
                />
                <rect x="11" y="9" width="2" height="6" rx="1" fill="#1b1206" />
                <circle cx="12" cy="17.5" r="1.1" fill="#1b1206" />
            </svg>
            <span>{t('hud.doorPrompt')}</span>
        </div>
    );
}
