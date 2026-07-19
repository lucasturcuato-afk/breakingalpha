import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { checkFixedWindow, clientKeyFromHeaders } from '@/lib/rate-limit'
import { registerWaitlist } from '@/lib/waitlist-register'

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

    // User is NOT allowlisted. Delegate to the shared server-side register so
    // the waitlist upsert + confirmation email are identical to every other
    // path (no duplicated insert/email logic here). It returns whether this was
    // a NEW row or an existing DUPLICATE; a duplicate routes to the
    // already-on-the-list variant. registerWaitlist is fail-safe and never
    // throws, but keep a guard so an unexpected error still lands the user on
    // /waitlist rather than an error page.
    let duplicate = false
    try {
      const reg = await registerWaitlist({
        email: userEmail,
        name: userName,
        source: 'oauth_callback',
      })
      duplicate = reg.approved === false && reg.duplicate
    } catch (e) {
      console.error('Waitlist register failed (non-blocking):', e)
    }

    await supabase.auth.signOut()
    return NextResponse.redirect(
      `${origin}/waitlist${duplicate ? '?existing=1' : ''}`,
    )
  }

  return NextResponse.redirect(`${origin}/auth?error=no_code`)
}
