import { useState } from 'preact/hooks';
import styles from './TrainControls.module.css';
import BipolarDial from './BipolarDial';
import IconButton from './IconButton';

function TrainControls() {
    const [isOpen, setIsOpen] = useState(false);
    const [dialValue, setDialValue] = useState(0);

    return (
        <div className={styles.container}>
            {!isOpen &&
                <IconButton
                    icon="/icons/controls.svg"
                    className={styles.toggleButton}
                    onClick={() => setIsOpen(true)}
                    ariaLabel="Toggle train controls"
                    iconSize={24}
                />
            }

            {/* Control Panel - Bottom of Screen */}
            <div className={`${styles.controlPanel} ${isOpen ? styles.controlPanelOpen : ''}`}>
                {/* Center Content - BipolarDial */}
                <div className={styles.dialContainer}>
                    <BipolarDial
                        value={dialValue}
                        onChange={setDialValue}
                        min={-100}
                        max={100}
                        size={220}
                    />
                    <IconButton toggle icon="/icons/lightbulb.svg" className={styles.lightIcon} onClick={() => setDialValue(0)} ariaLabel="Toggle light" />
                    <IconButton icon="/icons/controls-off.svg" className={styles.closeControls} onClick={() => setIsOpen(false)} ariaLabel="Close train controls" />
                </div>
            </div>
        </div>
    );
}

export default TrainControls;
