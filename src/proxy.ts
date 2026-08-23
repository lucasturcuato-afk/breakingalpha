import { createServerClient } from '@supabase/ssr'
import { postAuthDestination } from '@/lib/auth-redirect'
import { NextResponse, type NextRequest } from 'next/server'
import { isAllowlisted } from '@/lib/allowlist'

/**
 * Mobile redesign, steps 3 to 12 of
 * `design_handoff_signalera_mobile/IMPLEMENTATION_PROMPT.md` lines 101 to 116.
 *
 * Every screen in those steps has to be reachable by an unauthenticated client
 * so its scoped parity run, its 375/390/430 and 1440 audit, and its visual
 * smoke test can drive it. A signed-in session is not something a build agent
 * can obtain, so without this the whole verification chain measures `/auth`.
 *
 * LOCAL DEV ONLY, on exactly the precedent `/ledger` set: prod stays gated,
 * because each of these renders the user's own record the moment it is wired
 * to a loader. `process.env.NODE_ENV` is inlined at build time by Next, so a
 * production bundle cannot reach this branch at all.
 *
 * This list exists so that no individual screen unit has to edit this file.
 * Adding a route here is a foundation change, not a screen change.
 *
 * A prefix opens itself and its children: `/claim` covers `/claim/abc`.
 */
const MOBILE_REDESIGN_DEV_PATHS = [
  '/ledger',       // step 2, shipped. Folded in from its own clause below.
  '/review',       // step 4
  '/dashboard',    // step 5
  '/claim',        // step 6
  '/entry',        // step 6
  '/record',       // step 6
  '/evening-wrap', // step 7
  '/compose',      // step 7
  '/desk-record',  // step 7
  '/watch',        // step 8
  '/theses',       // step 8
  '/ask',          // step 9
  '/search',       // step 9
  '/company',      // step 9. Already public bare; this opens /company/[id] too.
  '/intelligence', // step 9
  '/deal-flow',    // step 10
  '/trends-mobile',// step 10
  '/signal',       // step 10
  '/story',        // step 10
  '/settings',     // step 12
  '/alerts',       // step 12
  '/saved',        // step 12
  '/learned',      // step 12
  '/share',        // step 12
]

function isMobileRedesignDevPath(path: string): boolean {
  if (process.env.NODE_ENV !== 'development') return false
  return MOBILE_REDESIGN_DEV_PATHS.some(
    (p) => path === p || path.startsWith(p + '/')
  )
}

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
    // Mobile redesign screens, steps 2 to 12. LOCAL DEV ONLY; see
    // MOBILE_REDESIGN_DEV_PATHS above. /ledger's own clause is folded into
    // that list rather than kept alongside it, so there is one place to read.
    isMobileRedesignDevPath(path) ||
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
      const url = request.nextUrl.clone()
      url.pathname = '/onboarding'
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
      const url = request.nextUrl.clone()
      url.pathname = '/dashboard'
      return NextResponse.redirect(url)
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logo.png|logo-icon.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
