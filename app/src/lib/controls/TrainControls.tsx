import { useState } from 'preact/hooks';
import styles from './TrainControls.module.css';
import BipolarDial from './BipolarDial';
import InlineSVG from '../../components/InlineSVG';

function TrainControls() {
    const [isOpen, setIsOpen] = useState(false);
    const [dialValue, setDialValue] = useState(0);

    return (
        <>
            {/* Toggle Button - Bottom Right Corner */}
            <button
                className={styles.toggleButton}
                onClick={() => setIsOpen(!isOpen)}
                aria-label="Toggle train controls"
            >
                <InlineSVG
                    src="/icons/gamepad.svg"
                    width={24}
                    height={24}
                />
            </button>

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
                </div>
            </div>
        </>
    );
}

export default TrainControls;
