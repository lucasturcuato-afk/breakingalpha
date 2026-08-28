import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { checkFixedWindow, clientKeyFromHeaders } from '@/lib/rate-limit'
import { registerWaitlist } from '@/lib/waitlist-register'
import { sendWaitlistConfirmationEmail } from '@/lib/waitlist-email'
import { POST_AUTH_DEFAULT, safeNext } from '@/lib/auth-redirect'
import { parseCohortFromParams } from '@/lib/cohort'

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
      // Allowlisted. Honour the destination the sign-in carried through the
      // provider round trip (the Morning Brief CTA sends ?next=/radar/calls...)
      // and fall back to the dashboard. safeNext keeps this from becoming an
      // open redirect: only same-origin relative paths get through.
      const next = safeNext(searchParams.get('next')) ?? POST_AUTH_DEFAULT
      return NextResponse.redirect(`${origin}${next}`)
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
      // Cohort rides the provider round trip in the query string, the same way
      // ?next= already does, because the account row is minted by Supabase in
      // the browser and this callback is the only server-side moment we control.
      // parseCohortFromParams validates against the closed enum and normalizes
      // the slugs, so an unrecognized value becomes null rather than a new
      // cohort. This is the path 99 of the 130 existing waitlist rows took.
      await registerWaitlist({
        email: userEmail,
        name: userName,
        source: 'oauth_callback',
        cohort: parseCohortFromParams(searchParams),
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
