import { useState } from 'preact/hooks';
import { supabase } from '../lib/Supabase';
import styles from './GateScreen.module.css';

export default function SignupForm() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');

    const handleSignup = async (e: Event) => {
        e.preventDefault();
        setLoading(true);
        setMessage('');
        setError('');

        const { error: signupError } = await supabase.auth.signUp({ email, password });

        if (signupError) {
            setError(signupError.message);
        } else {
            setMessage('Check your email to confirm your account.');
        }
        setLoading(false);
    };

    return (
        <div className={styles.container}>
            <h1 className={styles.title}>Create Account</h1>
            <div className={styles.content}>
                {message ? (
                    <>
                        <div className={styles.successBanner}>{message}</div>
                        <a href="/" className={styles.secondaryBtn}>Back to Login</a>
                    </>
                ) : (
                    <>
                        <form onSubmit={handleSignup} className={styles.form}>
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
                                    minLength={6}
                                    className={styles.input}
                                    placeholder="Min. 6 characters"
                                />
                            </div>
                            <button type="submit" disabled={loading} className={styles.primaryBtn}>
                                {loading ? 'Creating account...' : 'Sign Up'}
                            </button>
                            {error && <p className={styles.errorText}>{error}</p>}
                        </form>
                        <div className={styles.divider}>or</div>
                        <a href="/" className={styles.secondaryBtn}>Back to Login</a>
                    </>
                )}
            </div>
        </div>
    );
}
