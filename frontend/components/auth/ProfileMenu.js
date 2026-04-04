import { useState, useEffect, useRef } from 'react'
import clsx from 'clsx'
import { LogOut, Settings, User } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import Link from 'next/link'

export default function ProfileMenu() {
  const [user, setUser] = useState(null)
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    setOpen(false)
  }

  const initial = user?.email?.[0]?.toUpperCase() || 'U'

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={clsx(
          'flex items-center justify-center h-7 w-7 rounded-full',
          'bg-base-elevated border border-border-subtle',
          'text-11 font-semibold text-content-secondary',
          'hover:border-border sig-transition',
        )}
        aria-label="Profile menu"
      >
        {initial}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-[200px] rounded-md bg-base-elevated border border-border shadow-lg z-50 py-1">
          {user && (
            <div className="px-3 py-2 border-b border-border-subtle">
              <div className="text-12 font-medium text-content-primary truncate">
                {user.user_metadata?.full_name || user.email}
              </div>
              <div className="text-11 text-content-muted truncate font-mono">
                {user.email}
              </div>
            </div>
          )}

          <Link
            href="/settings"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-12 text-content-secondary hover:bg-base-overlay hover:text-content-primary sig-transition"
          >
            <Settings size={13} />
            Settings
          </Link>

          <button
            onClick={handleSignOut}
            className="flex items-center gap-2 w-full px-3 py-2 text-12 text-content-secondary hover:bg-base-overlay hover:text-content-primary sig-transition"
          >
            <LogOut size={13} />
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
