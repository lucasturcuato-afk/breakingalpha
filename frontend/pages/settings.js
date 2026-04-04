import { useState, useEffect } from 'react'
import Head from 'next/head'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabaseClient'
import { AppShell } from '../components/shell'
import {
  SettingsTabs,
  PreferencesSettings,
  AccountSettings,
} from '../components/settings'

export default function SettingsPage() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('preferences')

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.user) {
        router.replace('/')
        return
      }
      setUser(session.user)
      setLoading(false)
    })
  }, [router])

  if (loading || !user) return null

  return (
    <>
      <Head>
        <title>Settings — Signalera</title>
      </Head>
      <AppShell breadcrumb="Settings">
        <div className="flex flex-col h-full">
          <div className="px-6 py-4 border-b border-border-subtle">
            <h1 className="text-18 font-semibold text-content-primary">Settings</h1>
            <p className="text-12 text-content-muted mt-0.5">
              Manage your preferences and account
            </p>
          </div>

          <SettingsTabs active={tab} onChange={setTab} />

          <div className="flex-1 overflow-y-auto">
            {tab === 'preferences' && <PreferencesSettings user={user} />}
            {tab === 'account' && <AccountSettings />}
          </div>
        </div>
      </AppShell>
    </>
  )
}
