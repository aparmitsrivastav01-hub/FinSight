
import { useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  FileText,
  ShieldCheck,
  Eye,
  EyeOff,
  Mail,
  Lock,
} from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import './Auth.css'

export default function Login() {
  const [mode, setMode] = useState('login')
  const [showPassword, setShowPassword] = useState(false)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  function switchMode(nextMode) {
    setMode(nextMode)
    setMessage('')
    setError('')
    setPassword('')
  }

  async function handleAuth(event) {
    event.preventDefault()

    setLoading(true)
    setMessage('')
    setError('')

    try {
      const normalizedEmail = email.trim()

      if (mode === 'signup') {
        const { data, error: authError } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: {
            data: {
              full_name: fullName.trim(),
            },
            emailRedirectTo: `${window.location.origin}/login`,
          },
        })

        if (authError) throw authError

        if (data.session) {
          window.location.assign('/fingpt')
          return
        }

        setMessage(
          'Account created! Check your email for a confirmation link before signing in.'
        )
      } else {
        const { error: authError } =
          await supabase.auth.signInWithPassword({
            email: normalizedEmail,
            password,
          })

        if (authError) throw authError

        window.location.assign('/fingpt')
        return
      }
    } catch (err) {
      setError(err.message || 'Authentication failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handleGoogleAuth() {
    setLoading(true)
    setMessage('')
    setError('')

    try {
      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/fingpt`,
        },
      })
      if (authError) throw authError
    } catch (err) {
      setError(err.message || 'Google sign-in failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="auth-page">
      <header className="auth-nav">
        <a href="/" className="auth-logo">
          FinSight
        </a>

        <a href="/" className="auth-back">
          <ArrowLeft size={16} />
          Back to FinSight
        </a>
      </header>

      <section className="auth-layout">
        <div className="auth-intro">
          <span className="auth-badge">
            <span />
            YOUR FINANCIAL WORKSPACE
          </span>

          <h1>
            Your financial
            <br /> intelligence,
            <br /> in one place.
          </h1>

          <p className="auth-description">
            Sign in to continue exploring companies, analyzing
            financial data, and making smarter decisions with AI.
          </p>

          <div className="auth-benefits">
            <div>
              <span className="auth-benefit-icon">
                <BarChart3 />
              </span>
              <section>
                <h3>Analyze financial statements</h3>
                <p>Get insights from company filings.</p>
              </section>
            </div>

            <div>
              <span className="auth-benefit-icon">
                <FileText />
              </span>
              <section>
                <h3>Research companies</h3>
                <p>Track performance and market signals.</p>
              </section>
            </div>

            <div>
              <span className="auth-benefit-icon">
                <ShieldCheck />
              </span>
              <section>
                <h3>Make informed decisions</h3>
                <p>Powered by financial data and AI.</p>
              </section>
            </div>
          </div>
        </div>

        <div className="auth-card">
          <div className="auth-tabs">
            <button
              type="button"
              className={mode === 'login' ? 'active' : ''}
              onClick={() => switchMode('login')}
              disabled={loading}
            >
              Login
            </button>

            <button
              type="button"
              className={mode === 'signup' ? 'active' : ''}
              onClick={() => switchMode('signup')}
              disabled={loading}
            >
              Sign Up
            </button>
          </div>

          <h2>
            {mode === 'login' ? 'Welcome back' : 'Create your account'}
          </h2>

          <p className="auth-card-subtitle">
            {mode === 'login'
              ? 'Sign in to continue to FinSight'
              : 'Start exploring financial intelligence'}
          </p>

          <form onSubmit={handleAuth}>
            {mode === 'signup' && (
              <label className="auth-input">
                <span>
                  <FileText size={18} />
                </span>
                <input
                  type="text"
                  placeholder="Full name"
                  autoComplete="name"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  required
                />
              </label>
            )}

            <label className="auth-input">
              <span>
                <Mail size={18} />
              </span>
              <input
                type="email"
                placeholder="Enter your email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>

            <label className="auth-input">
              <span>
                <Lock size={18} />
              </span>
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Enter your password"
                  autoComplete={
                    mode === 'login' ? 'current-password' : 'new-password'
                  }
                  minLength={6}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />

                <button
                  type="button"
                  className="auth-eye"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
            </label>

            {mode === 'login' && (
              <div className="auth-form-meta">
                <label>
                  <input type="checkbox" defaultChecked />
                  Remember me
                </label>

                <button type="button" className="auth-text-button">
                  Forgot password?
                </button>
              </div>
            )}

            {error && (
              <p role="alert" className="auth-error">
                {error}
              </p>
            )}

            {message && (
              <p role="status" className="auth-message">
                {message}
              </p>
            )}

            <button
              type="submit"
              className="auth-submit"
              disabled={loading}
            >
              {loading
                ? 'Please wait...'
                : mode === 'login'
                  ? 'Sign in'
                  : 'Create account'}

              {!loading && <ArrowRight size={18} />}
            </button>
          </form>

          <div className="auth-divider">
            <span>OR CONTINUE WITH</span>
          </div>

          <button
            type="button"
            className="auth-google"
            onClick={handleGoogleAuth}
            disabled={loading}
          >
            <span className="google-g">G</span>
            Continue with Google
          </button>

          <p className="auth-switch">
            {mode === 'login'
              ? "Don't have an account?"
              : 'Already have an account?'}

            <button
              type="button"
              onClick={() =>
                switchMode(mode === 'login' ? 'signup' : 'login')
              }
              disabled={loading}
            >
              {mode === 'login' ? 'Sign up' : 'Login'}
            </button>
          </p>
        </div>
      </section>

      <footer className="auth-footer">
        <span>DATA</span>
        <i />
        <span>INSIGHTS</span>
        <i />
        <span>INTELLIGENCE</span>
      </footer>
    </main>
  )
}
