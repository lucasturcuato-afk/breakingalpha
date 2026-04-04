import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { LogOut } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import Button from '../primitives/Button'

function GoogleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  )
}

export default function AuthButton({ variant = 'default' }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  const handleSignIn = () => {
    supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
  }

  const handleSignOut = () => {
    supabase.auth.signOut()
  }

  if (loading) return null

  if (user) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-11 text-content-muted font-mono max-w-[140px] truncate">
          {user.email}
        </span>
        <Button variant="ghost" size="sm" onClick={handleSignOut}>
          <LogOut size={12} />
          Sign out
        </Button>
      </div>
    )
  }

  if (variant === 'hero') {
    return (
      <button
        onClick={handleSignIn}
        className={clsx(
          'inline-flex items-center gap-2.5 px-5 py-2.5 rounded-md',
          'border border-signal-500 bg-signal-muted',
          'text-13 font-medium text-signal-400',
          'hover:bg-signal-500/20 sig-transition',
        )}
      >
        <GoogleIcon />
        Sign in with Google — it&apos;s free
      </button>
    )
  }

  return (
    <Button variant="secondary" size="sm" onClick={handleSignIn}>
      <GoogleIcon />
      Sign in
    </Button>
  )
}
