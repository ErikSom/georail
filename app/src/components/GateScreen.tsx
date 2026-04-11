import { useState, useEffect } from 'preact/hooks';
import { supabase } from '../lib/Supabase';
import TrainSpinner from './TrainSpinner';
import styles from './GateScreen.module.css';

interface Props {
    checking: boolean;
    recoveryMode?: boolean;
    onRecoveryComplete?: () => void;
}

type Mode = 'login' | 'signup' | 'forgot' | 'reset';

export default function GateScreen({ checking, recoveryMode = false, onRecoveryComplete }: Props) {
    const [mode, setMode] = useState<Mode>(recoveryMode ? 'reset' : 'login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const [successMessage, setSuccessMessage] = useState('');

    useEffect(() => {
        if (recoveryMode) setMode('reset');
    }, [recoveryMode]);

    const switchMode = (next: Mode) => {
        setMode(next);
        setErrorMessage('');
        setSuccessMessage('');
        setPassword('');
    };

    const handleSubmit = async (e: Event) => {
        e.preventDefault();
        setLoading(true);
        setErrorMessage('');
        setSuccessMessage('');

        if (mode === 'login') {
            const { error } = await supabase.auth.signInWithPassword({ email, password });
            if (error) setErrorMessage(error.message);
        } else if (mode === 'signup') {
            const { error } = await supabase.auth.signUp({ email, password });
            if (error) {
                setErrorMessage(error.message);
            } else {
                setSuccessMessage('Check your email to confirm your account.');
            }
        } else if (mode === 'forgot') {
            const { error } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: window.location.origin,
            });
            if (error) {
                setErrorMessage(error.message);
            } else {
                setSuccessMessage('Check your email for a reset link.');
            }
        } else if (mode === 'reset') {
            const { error } = await supabase.auth.updateUser({ password });
            if (error) {
                setErrorMessage(error.message);
            } else {
                onRecoveryComplete?.();
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

    const title =
        mode === 'login' ? 'Welcome' :
        mode === 'signup' ? 'Create Account' :
        mode === 'forgot' ? 'Reset Password' :
        'Set New Password';

    const submitLabel =
        mode === 'login' ? 'Login' :
        mode === 'signup' ? 'Sign Up' :
        mode === 'forgot' ? 'Send Reset Link' :
        'Update Password';

    const loadingLabel =
        mode === 'login' ? 'Logging in...' :
        mode === 'signup' ? 'Creating account...' :
        mode === 'forgot' ? 'Sending...' :
        'Updating...';

    const showEmail = mode !== 'reset';
    const showPassword = mode !== 'forgot';

    return (
        <div className={styles.container}>
            <h1 className={styles.title}>{title}</h1>
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
                            {showEmail && (
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
                            )}
                            {showPassword && (
                                <div className={styles.inputGroup}>
                                    <label className={styles.inputLabel}>
                                        {mode === 'reset' ? 'New Password' : 'Password'}
                                    </label>
                                    <input
                                        type="password"
                                        value={password}
                                        onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
                                        required
                                        minLength={mode === 'login' ? undefined : 6}
                                        className={styles.input}
                                        placeholder="Min. 6 characters"
                                    />
                                </div>
                            )}
                            <button type="submit" disabled={loading} className={styles.primaryBtn}>
                                {loading ? loadingLabel : submitLabel}
                            </button>
                            {errorMessage && <p className={styles.errorText}>{errorMessage}</p>}
                        </form>

                        {mode === 'login' && (
                            <>
                                <button
                                    className={styles.linkBtn}
                                    onClick={() => switchMode('forgot')}
                                >
                                    Forgot password?
                                </button>
                                <div className={styles.divider}>or</div>
                                <button
                                    className={styles.secondaryBtn}
                                    onClick={() => switchMode('signup')}
                                >
                                    Create Account
                                </button>
                            </>
                        )}

                        {mode === 'signup' && (
                            <>
                                <div className={styles.divider}>or</div>
                                <button
                                    className={styles.secondaryBtn}
                                    onClick={() => switchMode('login')}
                                >
                                    Back to Login
                                </button>
                            </>
                        )}

                        {mode === 'forgot' && (
                            <>
                                <div className={styles.divider}>or</div>
                                <button
                                    className={styles.secondaryBtn}
                                    onClick={() => switchMode('login')}
                                >
                                    Back to Login
                                </button>
                            </>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
