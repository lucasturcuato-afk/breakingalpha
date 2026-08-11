import { createServerClient } from '@supabase/ssr'
import { postAuthDestination, postOnboardingDestination } from '@/lib/auth-redirect'
import { NextResponse, type NextRequest } from 'next/server'
import { isAllowlisted } from '@/lib/allowlist'

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options))
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname
  const isAuthPage = path === '/auth'
  const isOnboardingPage = path === '/onboarding'
  const isPublicPath =
    path === '/' ||
    path === '/preview' ||
    // Fixture harnesses (/preview/radar etc) open in LOCAL DEV ONLY so
    // visual smoke tests can run unauthenticated; prod stays gated.
    (path.startsWith('/preview/') && process.env.NODE_ENV === 'development') ||
    path === '/about' ||
    path === '/morning-brief' ||
    path === '/live-feed' ||
    path === '/trends' ||
    path === '/company' ||
    path === '/waitlist' || // beta waitlist landing page (non-allowlisted users land here)
    path.startsWith('/legal/') || // ToS, Privacy, Support — must be publicly accessible
    path.startsWith('/watchlist/') || // identifier detail pages; /watchlist (personal list) stays gated
    path.startsWith('/auth/callback') ||
    path.startsWith('/print/') || // Puppeteer-driven PDF render; the /print page itself enforces auth
    path.startsWith('/api/') // let API routes enforce their own auth

  if (!user && !isAuthPage && !isPublicPath) {
    const url = request.nextUrl.clone()
    url.pathname = '/auth'
    return NextResponse.redirect(url)
  }

  if (user && isAuthPage) {
    // An already-signed-in reader clicking the brief CTA lands here with
    // ?adopt=<id>. Send them to the call, not to the dashboard.
    const dest = postAuthDestination(request.nextUrl.search)
    return NextResponse.redirect(new URL(dest, request.nextUrl.origin))
  }

  // Beta allowlist gate — enforce BEYOND the OAuth callback.
  // A provisioned-but-non-approved session (e.g. one minted by direct password
  // sign-in, which never hit the callback) must not reach any gated route.
  // Fails closed: isAllowlisted returns false on any query error. The proxy runs
  // with the authenticated user's client, and RLS policy allowlist_read_self
  // lets a user read their OWN beta_allowlist row, so this needs no service role.
  if (user && !isAuthPage && !isPublicPath) {
    const allowed = await isAllowlisted(supabase, user.email)
    if (!allowed) {
      // Best-effort clear the session so it stops presenting as logged-in.
      // signOut mutates supabaseResponse cookies via the setAll adapter above;
      // we carry those onto the redirect. Even if signOut fails, redirecting to
      // the public /waitlist page already fails closed (gated routes stay out of
      // reach), mirroring the callback's non-approved handling.
      await supabase.auth.signOut()
      const url = request.nextUrl.clone()
      url.pathname = '/waitlist'
      const redirect = NextResponse.redirect(url)
      supabaseResponse.cookies.getAll().forEach((cookie) => {
        redirect.cookies.set(cookie)
      })
      return redirect
    }
  }

  // Onboarding gate — first-time users land on /onboarding.
  // Soft-fails: if the profile row or column doesn't exist, we treat the user
  // as already-onboarded and let the existing dashboard modal handle it.
  if (user && !isAuthPage && !isPublicPath && !isOnboardingPage) {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('onboarding_completed')
      .eq('id', user.id)
      .maybeSingle()
    if (profile && profile.onboarding_completed === false) {
      // Carry where they were going. Without this the emailed call link died
      // here even after the sign-in fix: the clone keeps ?adopt= but nothing
      // downstream reads it, and the wizard pushed /dashboard unconditionally.
      // `next` is the full relative URL so the wizard can re-synthesize the
      // #call- anchor; postOnboardingDestination gates it through safeNext.
      const url = request.nextUrl.clone()
      const intended = `${path}${request.nextUrl.search}`
      url.pathname = '/onboarding'
      url.search = ''
      url.searchParams.set('next', intended)
      return NextResponse.redirect(url)
    }
  }

  // If onboarding is complete, don't let them loop back into /onboarding.
  if (user && isOnboardingPage) {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('onboarding_completed')
      .eq('id', user.id)
      .maybeSingle()
    if (profile?.onboarding_completed === true) {
      // Already onboarded and asking for /onboarding: honour any ?next= they
      // arrived with rather than dropping them on the dashboard. This is the
      // path a user takes when they finish the wizard in one tab and the gate
      // re-fires in another.
      const dest = postOnboardingDestination(request.nextUrl.search)
      return NextResponse.redirect(new URL(dest, request.nextUrl.origin))
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logo.png|logo-icon.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
