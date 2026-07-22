import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { checkFixedWindow, clientKeyFromHeaders } from '@/lib/rate-limit'
import { registerWaitlist } from '@/lib/waitlist-register'
import { sendWaitlistConfirmationEmail } from '@/lib/waitlist-email'

// Coarse per-IP throttle on the OAuth callback (the one server-side auth entry
// point). Caps code-exchange attempts to slow credential-stuffing / replay
// floods. Durable across serverless instances when the Upstash env vars are set
// (see rate-limit.ts); falls back to in-memory only when they are absent and
// fails open if the store is unreachable. Password sign-in and signup run
// entirely in the browser against Supabase Auth, so they cannot be throttled
// here and rely on Supabase's own auth rate limits plus (recommended) Vercel WAF
// rules; their only server touchpoint is /api/waitlist/register, which is
// throttled by the same durable limiter.
const CALLBACK_RATE_LIMIT = 10
const CALLBACK_RATE_WINDOW_MS = 60_000

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')

  const rl = await checkFixedWindow(
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

    // User is NOT allowlisted. This callback runs only after proven ownership
    // (OAuth, or the clicked email/password confirmation link), so it is the ONE
    // place we send the confirmation email. First capture the row via the shared
    // register (allowlist check + non-approved upsert, no email), THEN send.
    //
    // Route the existing-variant on whether the row was ALREADY notified, NOT on
    // whether the row already existed: signup now eagerly creates the row, so
    // "row existed" would wrongly flag every first-time email/password confirmer
    // as existing. sendWaitlistConfirmationEmail reports alreadyNotified from the
    // notified_at guard, which is the correct semantic ("we already emailed you")
    // and keeps notified_at as the single source of no-resend. Both calls are
    // fail-safe; keep a guard so an unexpected error still lands the user on
    // /waitlist rather than an error page.
    let alreadyNotified = false
    try {
      await registerWaitlist({
        email: userEmail,
        name: userName,
        source: 'oauth_callback',
      })
      const send = await sendWaitlistConfirmationEmail(userEmail)
      alreadyNotified = send.alreadyNotified
    } catch (e) {
      console.error('Waitlist register/send failed (non-blocking):', e)
    }

    await supabase.auth.signOut()
    return NextResponse.redirect(
      `${origin}/waitlist${alreadyNotified ? '?existing=1' : ''}`,
    )
  }

  return NextResponse.redirect(`${origin}/auth?error=no_code`)
}
