import { useState } from 'react';
import { OFFLINE_WORKSPACE_USER, authService, isSupabaseConfigured, type AuthUser } from '../lib/auth';

interface AuthModalProps {
  externalError?: string | null;
  onAuthenticated: (user: AuthUser) => Promise<void> | void;
}

export const AuthModal = ({ externalError = null, onAuthenticated }: AuthModalProps) => {
  const [isSignup, setIsSignup] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  if (!isSupabaseConfigured) {
    return (
      <div className="auth-modal">
        <div className="auth-card">
          <h1>Offline Workspace</h1>
          <p className="auth-subtitle">
            Trade Engine saves locally on this computer. Use Send Workspace and Receive Workspace on the Imports page
            to move your journal data to another device.
          </p>

          <div className="auth-info">
            Remote account sync is disabled for this build. Trades, notes, tags, filters, and settings stay in this
            workspace until you export or transfer them.
          </div>

          {externalError ? <div className="auth-error">{externalError}</div> : null}

          <button type="button" className="auth-submit" onClick={() => void onAuthenticated(OFFLINE_WORKSPACE_USER)}>
            Open Offline Workspace
          </button>
        </div>
      </div>
    );
  }

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
        await onAuthenticated(user);
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
        <h1>{isSignup ? 'Create Sync Account' : 'Sign In'}</h1>
        <p className="auth-subtitle">
          {isSignup
            ? 'Trade Engine already saves locally. Create a sync account only if you explicitly want remote sync.'
            : 'Trade Engine is running in local-first mode. Sign in only if you intentionally enabled remote sync.'}
        </p>

        {success ? <div className="success-message">Account created. Sign in with your email and password.</div> : null}

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

          {isSignup ? (
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
          ) : null}

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

          {error || externalError ? <div className="auth-error">{error || externalError}</div> : null}

          <button type="submit" disabled={loading} className="auth-submit">
            {loading ? 'Loading...' : isSignup ? 'Create Sync Account' : 'Sign In'}
          </button>
        </form>

        <div className="auth-toggle">
          <span>{isSignup ? 'Already have a sync account?' : 'Need a sync account?'}</span>
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
            {isSignup ? 'Sign In' : 'Create One'}
          </button>
        </div>
      </div>
    </div>
  );
};
