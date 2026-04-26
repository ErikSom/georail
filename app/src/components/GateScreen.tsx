import { useState, useEffect } from 'preact/hooks';
import { supabase } from '../lib/Supabase';
import TrainSpinner from './TrainSpinner';
import { t } from '../i18n';
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
                setSuccessMessage(t('gate.success.checkEmailConfirm'));
            }
        } else if (mode === 'forgot') {
            const { error } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: window.location.origin,
            });
            if (error) {
                setErrorMessage(error.message);
            } else {
                setSuccessMessage(t('gate.success.checkEmailReset'));
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
                    <p className={styles.loadingText}>{t('gate.loading')}</p>
                </div>
            </div>
        );
    }

    const title = t(`gate.title.${mode}`);
    const submitLabel = t(`gate.submit.${mode}`);
    const loadingLabel = t(`gate.submitLoading.${mode}`);

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
                            {t('gate.links.backToLogin')}
                        </button>
                    </>
                ) : (
                    <>
                        <form onSubmit={handleSubmit} className={styles.form}>
                            {showEmail && (
                                <div className={styles.inputGroup}>
                                    <label className={styles.inputLabel}>{t('gate.fields.email')}</label>
                                    <input
                                        type="email"
                                        value={email}
                                        onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
                                        required
                                        className={styles.input}
                                        placeholder={t('gate.fields.emailPlaceholder')}
                                    />
                                </div>
                            )}
                            {showPassword && (
                                <div className={styles.inputGroup}>
                                    <label className={styles.inputLabel}>
                                        {mode === 'reset' ? t('gate.fields.newPassword') : t('gate.fields.password')}
                                    </label>
                                    <input
                                        type="password"
                                        value={password}
                                        onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
                                        required
                                        minLength={mode === 'login' ? undefined : 6}
                                        className={styles.input}
                                        placeholder={t('gate.fields.passwordPlaceholder')}
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
                                    {t('gate.links.forgotPassword')}
                                </button>
                                <div className={styles.divider}>{t('gate.or')}</div>
                                <button
                                    className={styles.secondaryBtn}
                                    onClick={() => switchMode('signup')}
                                >
                                    {t('gate.links.createAccount')}
                                </button>
                            </>
                        )}

                        {mode === 'signup' && (
                            <>
                                <div className={styles.divider}>{t('gate.or')}</div>
                                <button
                                    className={styles.secondaryBtn}
                                    onClick={() => switchMode('login')}
                                >
                                    {t('gate.links.backToLogin')}
                                </button>
                            </>
                        )}

                        {mode === 'forgot' && (
                            <>
                                <div className={styles.divider}>{t('gate.or')}</div>
                                <button
                                    className={styles.secondaryBtn}
                                    onClick={() => switchMode('login')}
                                >
                                    {t('gate.links.backToLogin')}
                                </button>
                            </>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
