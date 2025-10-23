import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/Supabase';

import styles from './Auth.module.css';
import utils from '../styles/utils.module.css';

export default function Auth() {
    const [session, setSession] = useState<Session | null>(null);
    const [showLogin, setShowLogin] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState('');

    useEffect(() => {
        supabase.auth.getSession().then(({ data: { session } }) => {
            setSession(session);
        });

        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            (_event, session) => {
                setSession(session);
                setShowLogin(false);
                setLoading(false);
                setMessage('');
                setEmail('');
                setPassword('');
            }
        );

        return () => subscription.unsubscribe();
    }, []);

    const handleLogin = async (e: preact.TargetedSubmitEvent<HTMLFormElement>) => {
        e.preventDefault();
        setLoading(true);
        setMessage('');
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) setMessage(error.message);
        setLoading(false);
    };

    const handleLogout = async () => {
        setLoading(true);
        await supabase.auth.signOut();
        setLoading(false);
    };


    // If user is logged in, show their email and a logout button
    if (session) {
        return (
            <div className={styles.authWidget}>
                <p>Logged in as: <strong>{session.user.email}</strong></p>
                <button onClick={handleLogout} disabled={loading} className={utils.button}>
                    {loading ? 'Logging out...' : 'Logout'}
                </button>
            </div>
        );
    }

    // If user is not logged in, show Login and Sign Up buttons
    return (
        <div className={styles.authWidget}>
            <button onClick={() => setShowLogin(true)} className={utils.button}>
                Login
            </button>
            <a href="/signup" className={utils.button}>
                Sign Up
            </a>

            {/* Login Modal */}
            {showLogin && (
                <div className={styles.modalOverlay}>
                    <div className={styles.modalContent}>
                        <button className={styles.closeBtn} onClick={() => setShowLogin(false)}>&times;</button>
                        <h3>Login</h3>
                        <form onSubmit={handleLogin} className={utils.form}>
                            <label>
                                Email:
                                <input
                                    type="email"
                                    value={email}
                                    onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
                                    required
                                />
                            </label>
                            <label>
                                Password:
                                <input
                                    type="password"
                                    value={password}
                                    onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
                                    required
                                />
                            </label>
                            <button type="submit" disabled={loading} className={utils.button}>
                                {loading ? 'Logging in...' : 'Login'}
                            </button>
                            {message && <p className={utils.error}>{message}</p>}
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}