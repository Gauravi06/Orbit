import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowRight, Loader2 } from 'lucide-react';
import { login, signup, errText } from '../api/client';
import ThemeToggle from '../components/ThemeToggle';
import './Login.css';

const IS_MOCK = import.meta.env.VITE_USE_MOCK === 'true';

export function Login() {
  const [isSignup, setIsSignup] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    email: 'demo@orbit.app',
    password: 'password123',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [validationErrors, setValidationErrors] = useState({});

  const navigate = useNavigate();

  const handleChange = (field) => (e) => {
    setFormData({ ...formData, [field]: e.target.value });
    if (validationErrors[field]) {
      setValidationErrors({ ...validationErrors, [field]: '' });
    }
  };

  const validate = () => {
    const errs = {};
    if (isSignup && !formData.name.trim()) {
      errs.name = 'Please enter your name.';
    }
    if (!formData.email.trim()) {
      errs.email = 'Please enter your email address.';
    } else if (!formData.email.includes('@')) {
      errs.email = 'Please enter a valid email address.';
    }
    if (!formData.password) {
      errs.password = 'Please enter your password.';
    } else if (formData.password.length < 8) {
      errs.password = 'Password must be at least 8 characters.';
    }
    setValidationErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!validate()) return;

    setLoading(true);
    try {
      let res;
      if (isSignup) {
        res = await signup({
          name: formData.name,
          email: formData.email,
          password: formData.password,
        });
      } else {
        res = await login({
          email: formData.email,
          password: formData.password,
        });
      }

      if (res?.access_token) {
        localStorage.setItem('orbit_token', res.access_token);
        localStorage.setItem('token', res.access_token);
      }

      // If signing up, take to onboarding; otherwise today
      if (isSignup) {
        navigate('/onboarding');
      } else {
        navigate('/today');
      }
    } catch (err) {
      setError(errText(err));
    } finally {
      setLoading(false);
    }
  };

  const handleDemoFill = () => {
    setFormData({
      name: 'Demo Student',
      email: 'demo@orbit.app',
      password: 'password123',
    });
    setValidationErrors({});
    setError('');
  };

  return (
    <div className="auth-page">
      <header className="auth-header">
        <div className="auth-brand">
          <span className="auth-brand-symbol">◐</span>
          <span className="auth-brand-title">Orbit</span>
        </div>
        <ThemeToggle showLabel={false} />
      </header>

      <div className="auth-container">
        <div className="auth-card">
          <div>
            <h1 className="auth-title">
              {isSignup ? 'Create your planner' : 'Welcome back'}
            </h1>
            <p className="auth-subtitle">
              {isSignup
                ? 'Set up a quiet, adaptive schedule that flexes when your week changes.'
                : 'Log in to view your adaptive plan and study blocks.'}
            </p>
          </div>

          {error && (
            <div className="auth-error-banner" role="alert">
              <AlertCircle size={15} strokeWidth={1.5} />
              <span>{error}</span>
            </div>
          )}

          <form className="auth-form" onSubmit={handleSubmit} noValidate>
            {isSignup && (
              <div className="form-group">
                <label htmlFor="auth-name">Your Name</label>
                <input
                  id="auth-name"
                  type="text"
                  className={`input ${validationErrors.name ? 'input-error' : ''}`}
                  placeholder="e.g. Maya Lin"
                  value={formData.name}
                  onChange={handleChange('name')}
                  aria-invalid={!!validationErrors.name}
                  aria-describedby={validationErrors.name ? 'auth-name-error' : undefined}
                />
                {validationErrors.name && (
                  <span id="auth-name-error" className="form-error">
                    {validationErrors.name}
                  </span>
                )}
              </div>
            )}

            <div className="form-group">
              <label htmlFor="auth-email">Email Address</label>
              <input
                id="auth-email"
                type="email"
                className={`input ${validationErrors.email ? 'input-error' : ''}`}
                placeholder="you@university.edu"
                value={formData.email}
                onChange={handleChange('email')}
                aria-invalid={!!validationErrors.email}
                aria-describedby={validationErrors.email ? 'auth-email-error' : undefined}
              />
              {validationErrors.email && (
                <span id="auth-email-error" className="form-error">
                  {validationErrors.email}
                </span>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="auth-password">Password</label>
              <input
                id="auth-password"
                type="password"
                className={`input ${validationErrors.password ? 'input-error' : ''}`}
                placeholder="At least 8 characters"
                value={formData.password}
                onChange={handleChange('password')}
                aria-invalid={!!validationErrors.password}
                aria-describedby={validationErrors.password ? 'auth-password-error' : undefined}
              />
              {validationErrors.password && (
                <span id="auth-password-error" className="form-error">
                  {validationErrors.password}
                </span>
              )}
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading}
              style={{ marginTop: 'var(--space-2)', width: '100%' }}
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="spin" strokeWidth={1.5} />
                  <span>{isSignup ? 'Creating account…' : 'Logging in…'}</span>
                </>
              ) : (
                <>
                  <span>{isSignup ? 'Create Account' : 'Log In'}</span>
                  <ArrowRight size={16} strokeWidth={1.5} />
                </>
              )}
            </button>
          </form>

          <div className="auth-toggle">
            <span>{isSignup ? 'Already have an account?' : 'New to Orbit?'}</span>
            <button
              type="button"
              className="auth-toggle-btn"
              onClick={() => {
                setIsSignup(!isSignup);
                setError('');
                setValidationErrors({});
              }}
            >
              {isSignup ? 'Log in instead' : 'Sign up'}
            </button>
          </div>

          {IS_MOCK && (
            <div className="auth-demo-hint">
              <span>Instant demo credentials:</span>
              <button
                type="button"
                className="auth-demo-btn"
                onClick={handleDemoFill}
              >
                Fill Demo: demo@orbit.app / password123
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Login;
