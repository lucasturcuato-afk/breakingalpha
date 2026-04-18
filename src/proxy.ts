import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

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
    path === '/about' ||
    path === '/morning-brief' ||
    path === '/live-feed' ||
    path === '/trends' ||
    path === '/company' ||
    path.startsWith('/watchlist/') || // identifier detail pages; /watchlist (personal list) stays gated
    path.startsWith('/auth/callback') ||
    path.startsWith('/api/') // let API routes enforce their own auth

  if (!user && !isAuthPage && !isPublicPath) {
    const url = request.nextUrl.clone()
    url.pathname = '/auth'
    return NextResponse.redirect(url)
  }

  if (user && isAuthPage) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
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
