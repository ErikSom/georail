import { useEffect } from 'preact/hooks';
import TravelPicker from './TravelPicker';
import styles from './MenuScreen.module.css';

export default function MenuScreen() {
    useEffect(() => {
        document.body.style.overflow = 'auto';
        document.body.style.touchAction = 'auto';
        return () => {
            document.body.style.overflow = '';
            document.body.style.touchAction = '';
        };
    }, []);

    return (
        <div className={styles.screen}>
            <div className={styles.logoWrapper}>
                <div className={styles.trapezoid} />
                <img src="/logo.svg" alt="Georail" className={styles.logo} />
            </div>
            <TravelPicker />
            <footer className={styles.footer}>© 2025 Terminarch Games</footer>
        </div>
    );
}
