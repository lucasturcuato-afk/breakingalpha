"use client"

import Link from "next/link"

export default function WaitlistPage() {
  return (
    <div className="min-h-screen bg-parchment flex items-center justify-center px-4 py-12">
      <div className="max-w-lg w-full">
        <div className="bg-white rounded-2xl border border-border-base shadow-sm p-8 sm:p-12 text-center">
          <div className="mb-6">
            <span className="font-serif text-4xl sm:text-5xl font-bold text-espresso">
              Signalera
            </span>
          </div>

          <h1 className="font-serif text-2xl sm:text-3xl font-bold text-espresso mb-4">
            You&apos;re on the waitlist
          </h1>

          <p className="text-text-muted text-base sm:text-lg leading-relaxed mb-6">
            Signalera is currently in private beta with a small group of users at USC. We&apos;ve added you to the waitlist and will reach out when we open up access.
          </p>

          <p className="text-text-muted text-sm mb-8">
            If you believe you should already have access, please email{" "}
            <a
              href="mailto:admin@signalera.ai"
              className="text-gold hover:underline font-medium"
            >
              admin@signalera.ai
            </a>
          </p>

          <Link
            href="/"
            className="inline-block px-6 py-3 bg-espresso text-parchment rounded-lg font-medium hover:bg-espresso/90 transition-colors"
          >
            Back to homepage
          </Link>
        </div>

        <p className="text-center text-xs text-text-muted mt-6">
          © 2026 Signalera. AI-generated content. Not investment advice.
        </p>
      </div>
    </div>
  )
}
