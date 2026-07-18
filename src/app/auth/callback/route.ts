import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { checkFixedWindow, clientKeyFromHeaders } from '@/lib/rate-limit'
import { sendWaitlistConfirmationEmail } from '@/lib/waitlist-email'

// Coarse per-IP throttle on the OAuth callback (the one server-side auth entry
// point). Caps code-exchange attempts to slow credential-stuffing / replay
// floods. In-memory + per serverless instance (see rate-limit.ts); this is a
// speed bump, not a durable guarantee. Password sign-in and signup run entirely
// in the browser against Supabase Auth, so they cannot be throttled here and
// rely on Supabase's own auth rate limits plus (recommended) Vercel WAF rules.
const CALLBACK_RATE_LIMIT = 10
const CALLBACK_RATE_WINDOW_MS = 60_000

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')

  const rl = checkFixedWindow(
    `auth-callback:${clientKeyFromHeaders(request.headers)}`,
    CALLBACK_RATE_LIMIT,
    CALLBACK_RATE_WINDOW_MS,
  )
  if (!rl.allowed) {
    console.warn('Auth callback rate limit hit')
    return NextResponse.redirect(`${origin}/auth?error=too_many_requests`)
  }

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
      // Continue anyway. Don't block the redirect.
    }

    // Fire the transactional confirmation email. Idempotent (guarded on
    // notified_at) and fully non-blocking: any failure is swallowed inside the
    // util, and this extra try/catch guarantees the signup and the /waitlist
    // redirect survive even an unexpected throw. If RESEND_API_KEY is unset the
    // util skips the send and logs it.
    try {
      await sendWaitlistConfirmationEmail(userEmail)
    } catch (e) {
      console.error('Waitlist confirmation email failed (non-blocking):', e)
    }

    await supabase.auth.signOut()
    return NextResponse.redirect(`${origin}/waitlist`)
  }

  return NextResponse.redirect(`${origin}/auth?error=no_code`)
}
