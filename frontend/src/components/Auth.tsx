import { useState, FormEvent } from 'react';
import { toast } from 'sonner';
import { login, setToken } from '../lib/api';
import AuthDither from './AuthDither';

interface Props {
  onAuthed: (token: string) => void;
}

// Login screen modeled on shadcn/ui's login-03 block (centered card, labeled
// fields), restyled to the panel-* theme so it matches the rest of the app.
export default function Auth({ onAuthed }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const token = await login(username, password);
      setToken(token);
      onAuthed(token);
    } catch (err) {
      toast.error('Sign in failed', {
        description: err instanceof Error ? err.message : 'Invalid credentials',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center gap-6 bg-panel-bg p-6 md:p-10 overflow-hidden"
      style={{
        paddingLeft: 'max(1.5rem, env(safe-area-inset-left))',
        paddingRight: 'max(1.5rem, env(safe-area-inset-right))',
        paddingTop: 'max(1.5rem, env(safe-area-inset-top))',
        paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))',
      }}
    >
      <AuthDither logo="/logo-512.png" />

      <div className="relative z-10 flex w-full max-w-sm flex-col gap-6">
        {/* Brand row above the card */}
        <div className="flex items-center gap-2 self-center font-medium">
          <img
            src="/logo-48.webp"
            alt="voidbunny"
            width={28}
            height={28}
            draggable={false}
            className="w-7 h-7 select-none"
          />
          <span className="text-base font-semibold tracking-wide text-panel-text">voidbunny</span>
        </div>

        {/* Card */}
        <div className="rounded-xl border border-panel-border bg-panel-surface shadow-lg">
          <div className="flex flex-col gap-2 px-6 pt-6 pb-4 text-center">
            <h1 className="text-2xl font-semibold tracking-tight text-panel-text">
              Welcome back
            </h1>
            <p className="text-sm text-panel-muted">
              Sign in to your panel
            </p>
          </div>

          <form onSubmit={onSubmit} className="px-6 pb-6">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <label
                  htmlFor="auth-username"
                  className="text-xs font-medium tracking-wide uppercase text-panel-muted"
                >
                  Username
                </label>
                <input
                  id="auth-username"
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full h-10 px-3 rounded-md bg-panel-bg border border-panel-border text-panel-text placeholder:text-panel-muted focus:outline-none focus:ring-2 focus:ring-panel-text/30 focus:border-panel-text font-mono text-base sm:text-sm transition-shadow"
                  required
                  disabled={busy}
                />
              </div>

              <div className="flex flex-col gap-2">
                <label
                  htmlFor="auth-password"
                  className="text-xs font-medium tracking-wide uppercase text-panel-muted"
                >
                  Password
                </label>
                <input
                  id="auth-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full h-10 px-3 rounded-md bg-panel-bg border border-panel-border text-panel-text placeholder:text-panel-muted focus:outline-none focus:ring-2 focus:ring-panel-text/30 focus:border-panel-text font-mono text-base sm:text-sm transition-shadow"
                  required
                  disabled={busy}
                />
              </div>

              <button
                type="submit"
                disabled={busy}
                className="w-full h-10 mt-1 rounded-md bg-panel-text text-panel-bg text-sm font-semibold tracking-wide hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
              >
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
            </div>
          </form>
        </div>

        <p className="px-6 text-center text-xs text-panel-muted">
          Self-hosted panel. Your credentials never leave this server.
        </p>
      </div>
    </div>
  );
}
