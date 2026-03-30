import { useState } from 'preact/hooks';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/Supabase';
import { createStripeCheckout, connectPatreon } from '../lib/api/subscription';
import styles from './GateScreen.module.css';

interface Props {
    session: Session | null;
    isPremium: boolean | null;
    checking: boolean;
    onLogout: () => void;
}

export default function GateScreen({ session, isPremium, checking, onLogout }: Props) {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loginLoading, setLoginLoading] = useState(false);
    const [loginMessage, setLoginMessage] = useState('');
    const [actionLoading, setActionLoading] = useState<string | null>(null);

    const handleLogin = async (e: Event) => {
        e.preventDefault();
        setLoginLoading(true);
        setLoginMessage('');
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) setLoginMessage(error.message);
        setLoginLoading(false);
    };

    async function handleStripeCheckout() {
        setActionLoading('stripe');
        const url = await createStripeCheckout();
        if (url) window.location.href = url;
        setActionLoading(null);
    }

    async function handleConnectPatreon() {
        setActionLoading('patreon');
        const url = await connectPatreon();
        if (url) window.location.href = url;
        setActionLoading(null);
    }

    // Loading state
    if (checking) {
        return (
            <div className={styles.container}>
                <div className={styles.content}>
                    <p className={styles.loadingText}>Loading...</p>
                </div>
            </div>
        );
    }

    // Not logged in
    if (!session) {
        return (
            <div className={styles.container}>
                <h1 className={styles.title}>Welcome</h1>
                <div className={styles.content}>
                    <form onSubmit={handleLogin} className={styles.form}>
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
                                className={styles.input}
                                placeholder="Min. 6 characters"
                            />
                        </div>
                        <button type="submit" disabled={loginLoading} className={styles.primaryBtn}>
                            {loginLoading ? 'Logging in...' : 'Login'}
                        </button>
                        {loginMessage && <p className={styles.errorText}>{loginMessage}</p>}
                    </form>
                    <div className={styles.divider}>or</div>
                    <a href="/signup" className={styles.secondaryBtn}>Create Account</a>
                </div>
            </div>
        );
    }

    // Logged in but not premium
    return (
        <div className={styles.container}>
            <h1 className={styles.title}>Subscribe to Play</h1>
            <div className={styles.content}>
                <p className={styles.subscribeText}>
                    Get access to GeoRail and join the premium Discord community.
                </p>
                <button
                    className={styles.primaryBtn}
                    onClick={handleStripeCheckout}
                    disabled={actionLoading !== null}
                >
                    {actionLoading === 'stripe' ? 'Redirecting...' : 'Subscribe'}
                </button>
                <div className={styles.divider}>or</div>
                <button
                    className={styles.patreonBtn}
                    onClick={handleConnectPatreon}
                    disabled={actionLoading !== null}
                >
                    <span className={styles.btnIcon} style={{ maskImage: 'url(/icons/patreon.svg)', WebkitMaskImage: 'url(/icons/patreon.svg)' }} />
                    {actionLoading === 'patreon' ? 'Redirecting...' : 'Subscribe on Patreon'}
                </button>
                <button className={styles.logoutBtn} onClick={onLogout}>
                    Logout
                </button>
            </div>
        </div>
    );
}
