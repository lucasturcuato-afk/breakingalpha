import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')

  if (error) {
    console.error('OAuth callback error:', error)
    return NextResponse.redirect(`${origin}/auth?error=${error}`)
  }

  if (code) {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll() },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          },
        },
      }
    )

    const { error: exchangeError, data } = await supabase.auth.exchangeCodeForSession(code)

    if (exchangeError) {
      console.error('Exchange error:', exchangeError.message)
      return NextResponse.redirect(`${origin}/auth?error=exchange_failed`)
    }

    // ============================================================
    // BETA ALLOWLIST GATE
    // ============================================================
    const userEmail = data.user?.email?.toLowerCase()
    const userName = data.user?.user_metadata?.full_name || data.user?.user_metadata?.name || null

    if (!userEmail) {
      console.error('No email in session after exchange')
      await supabase.auth.signOut()
      return NextResponse.redirect(`${origin}/auth?error=no_email`)
    }

    // Check beta_allowlist
    const { data: allowed, error: allowlistError } = await supabase
      .from('beta_allowlist')
      .select('email')
      .eq('email', userEmail)
      .maybeSingle()

    if (allowlistError) {
      console.error('Allowlist check error:', allowlistError.message)
      // Fail-closed: if we can't verify, don't let them in
      await supabase.auth.signOut()
      return NextResponse.redirect(`${origin}/auth?error=allowlist_check_failed`)
    }

    if (allowed) {
      // User is allowlisted — proceed to dashboard
      return NextResponse.redirect(`${origin}/dashboard`)
    }

    // User is NOT allowlisted — add to waitlist, sign out, redirect
    const { error: waitlistError } = await supabase
      .from('waitlist')
      .insert({
        email: userEmail,
        name: userName,
        source: 'oauth_callback',
      })

    if (waitlistError && !waitlistError.message.includes('duplicate')) {
      console.error('Waitlist insert error:', waitlistError.message)
      // Continue anyway — don't block the redirect
    }

    await supabase.auth.signOut()
    return NextResponse.redirect(`${origin}/waitlist`)
  }

  return NextResponse.redirect(`${origin}/auth?error=no_code`)
}
