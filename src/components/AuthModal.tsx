import { useState } from 'react';
import { authService, type AuthUser } from '../lib/auth';

interface AuthModalProps {
  onAuthenticated: (user: AuthUser) => void;
}

export const AuthModal = ({ onAuthenticated }: AuthModalProps) => {
  const [isSignup, setIsSignup] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setLoading(true);

    try {
      const user = isSignup
        ? await authService.signup(email, password, username)
        : await authService.login(email, password);

      if (isSignup) {
        setSuccess(true);
        setEmail('');
        setPassword('');
        setUsername('');
        setTimeout(() => {
          setIsSignup(false);
          setSuccess(false);
        }, 2000);
      } else {
        onAuthenticated(user);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-modal">
      <div className="auth-card">
        <h1>{isSignup ? 'Create Account' : 'Sign In'}</h1>
        <p className="auth-subtitle">
          {isSignup
            ? 'Join Trade Engine to sync your data across devices'
            : 'Access your trades and journals from any device'}
        </p>

        {success && (
          <div className="success-message">
            ✓ Account created! Sign in with your email and password.
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              disabled={loading}
            />
          </div>

          {isSignup && (
            <div className="form-group">
              <label htmlFor="username">Username (optional)</label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Your trading name"
                disabled={loading}
              />
            </div>
          )}

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter a strong password"
              required
              disabled={loading}
              minLength={6}
            />
          </div>

          {error && <div className="auth-error">{error}</div>}

          <button type="submit" disabled={loading} className="auth-submit">
            {loading ? 'Loading...' : isSignup ? 'Create Account' : 'Sign In'}
          </button>
        </form>

        <div className="auth-toggle">
          <span>
            {isSignup ? 'Already have an account?' : "Don't have an account?"}
          </span>
          <button
            type="button"
            onClick={() => {
              setIsSignup(!isSignup);
              setError(null);
              setSuccess(false);
            }}
            disabled={loading}
            className="auth-toggle-btn"
          >
            {isSignup ? 'Sign In' : 'Sign Up'}
          </button>
        </div>
      </div>
    </div>
  );
};
