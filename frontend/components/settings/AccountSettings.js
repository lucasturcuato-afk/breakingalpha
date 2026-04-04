import { useState, useEffect } from 'react'
import { LogOut } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import Button from '../primitives/Button'
import Separator from '../primitives/Separator'
import Skeleton from '../primitives/Skeleton'

function MetaRow({ label, value, mono = false }) {
  if (!value) return null
  return (
    <div className="flex items-center justify-between py-2.5">
      <span className="text-12 text-content-muted">{label}</span>
      <span className={`text-12 text-content-primary ${mono ? 'font-mono tabular-nums' : ''}`}>
        {value}
      </span>
    </div>
  )
}

export default function AccountSettings() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })
  }, [])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    window.location.href = '/'
  }

  if (loading) {
    return (
      <div className="p-6 space-y-3 max-w-[500px]">
        <Skeleton width="160px" height="20px" rounded="md" />
        <Skeleton width="100%" height="14px" rounded="sm" />
        <Skeleton width="100%" height="14px" rounded="sm" />
      </div>
    )
  }

  const createdAt = user?.created_at
    ? new Date(user.created_at).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
      })
    : null

  return (
    <div className="p-6 max-w-[500px]">
      <h2 className="text-18 font-semibold text-content-primary mb-1">Account</h2>
      <p className="text-12 text-content-muted mb-6">
        Your account details and session information.
      </p>

      <div className="divide-y divide-border-subtle mb-6">
        <MetaRow label="Name" value={user?.user_metadata?.full_name} />
        <MetaRow label="Email" value={user?.email} mono />
        <MetaRow label="Provider" value={user?.app_metadata?.provider || 'Google'} />
        <MetaRow label="Member since" value={createdAt} mono />
        <MetaRow label="User ID" value={user?.id?.slice(0, 12) + '...'} mono />
      </div>

      <Separator className="mb-6" />

      <div>
        <div className="text-11 font-semibold text-content-muted uppercase tracking-wider mb-3">
          Session
        </div>
        <Button variant="danger" size="sm" onClick={handleSignOut}>
          <LogOut size={13} />
          Sign out
        </Button>
      </div>
    </div>
  )
}
