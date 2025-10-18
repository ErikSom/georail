import { useState } from 'preact/hooks';
import { supabase } from '../lib/Supabase';
import styles from './SignupForm.module.css';
import utils from '../styles/utils.module.css';


export default function SignupForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const handleSignup = async (e: preact.TargetedUIEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');
    setError('');

    const { error } = await supabase.auth.signUp({ 
      email, 
      password 
    });

    console.log('Signup response error:', error);

    if (error) {
      setError(error.message);
    } else {
      setMessage('Success! Please check your email to confirm your account.');
    }
    setLoading(false);
  };


  return (
    <div className={styles.signupFormContainer}>
      <h2>Create an Account</h2>
      <form onSubmit={handleSignup} className={utils.form}>
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
          Password (min. 6 characters):
          <input
            type="password"
            value={password}
            onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
            required
            minLength={6}
          />
        </label>
        <button type="submit" disabled={loading} className={utils.button}>
          {loading ? 'Creating account...' : 'Sign Up'}
        </button>
        {message && <p className={utils.success}>{message}</p>}
        {error && <p className={utils.error}>{error}</p>}
      </form>
      <p>
        Already have an account? <a href="/">Go back to Login</a>
      </p>
    </div>
  );
}