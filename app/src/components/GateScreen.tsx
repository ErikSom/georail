import { useState } from 'preact/hooks';
import { supabase } from '../lib/Supabase';
import TrainSpinner from './TrainSpinner';
import styles from './GateScreen.module.css';

interface Props {
    checking: boolean;
}

type Mode = 'login' | 'signup';

export default function GateScreen({ checking }: Props) {
    const [mode, setMode] = useState<Mode>('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const [successMessage, setSuccessMessage] = useState('');

    const switchMode = (next: Mode) => {
        setMode(next);
        setErrorMessage('');
        setSuccessMessage('');
    };

    const handleSubmit = async (e: Event) => {
        e.preventDefault();
        setLoading(true);
        setErrorMessage('');
        setSuccessMessage('');

        if (mode === 'login') {
            const { error } = await supabase.auth.signInWithPassword({ email, password });
            if (error) setErrorMessage(error.message);
        } else {
            const { error } = await supabase.auth.signUp({ email, password });
            if (error) {
                setErrorMessage(error.message);
            } else {
                setSuccessMessage('Check your email to confirm your account.');
            }
        }

        setLoading(false);
    };

    if (checking) {
        return (
            <div className={styles.container}>
                <div className={styles.content}>
                    <TrainSpinner />
                    <p className={styles.loadingText}>Departing shortly...</p>
                </div>
            </div>
        );
    }

    const isLogin = mode === 'login';

    return (
        <div className={styles.container}>
            <h1 className={styles.title}>{isLogin ? 'Welcome' : 'Create Account'}</h1>
            <div className={styles.content}>
                {successMessage ? (
                    <>
                        <div className={styles.successBanner}>{successMessage}</div>
                        <button className={styles.secondaryBtn} onClick={() => switchMode('login')}>
                            Back to Login
                        </button>
                    </>
                ) : (
                    <>
                        <form onSubmit={handleSubmit} className={styles.form}>
                            <div className={styles.inputGroup}>
                                <label className={styles.inputLabel}>Email</label>
                                <input
                                    type="email"
                                    value={email}
                                    onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
                                    required
                                    className={styles.input}
                                    placeholder="your@email.com"
                                />
                            </div>
                            <div className={styles.inputGroup}>
                                <label className={styles.inputLabel}>Password</label>
                                <input
                                    type="password"
                                    value={password}
                                    onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
                                    required
                                    minLength={isLogin ? undefined : 6}
                                    className={styles.input}
                                    placeholder="Min. 6 characters"
                                />
                            </div>
                            <button type="submit" disabled={loading} className={styles.primaryBtn}>
                                {loading
                                    ? (isLogin ? 'Logging in...' : 'Creating account...')
                                    : (isLogin ? 'Login' : 'Sign Up')}
                            </button>
                            {errorMessage && <p className={styles.errorText}>{errorMessage}</p>}
                        </form>
                        <div className={styles.divider}>or</div>
                        <button
                            className={styles.secondaryBtn}
                            onClick={() => switchMode(isLogin ? 'signup' : 'login')}
                        >
                            {isLogin ? 'Create Account' : 'Back to Login'}
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}
