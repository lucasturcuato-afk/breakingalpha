"use client"

import Link from "next/link"
import { Wordmark } from "@/components/ui/wordmark"

export default function WaitlistPage() {
  return (
    <div className="min-h-screen bg-parchment flex items-center justify-center px-4 py-12">
      <div className="max-w-lg w-full">
        <div className="bg-elevated rounded-2xl border border-border-base shadow-sm p-8 sm:p-12 text-center">
          <div className="mb-6 flex justify-center">
            {/* Same wordmark as the landing and modal: Signal in ink, era in
                brass, followed by a period. Reuses the shared Wordmark and adds
                the trailing period in the same gold. */}
            <span
              className="inline-flex items-baseline font-display font-bold"
              style={{ fontSize: "26px", lineHeight: 1 }}
            >
              <Wordmark size="lg" />
              <span className="text-gold">.</span>
            </span>
          </div>

          <h1 className="font-serif text-2xl sm:text-3xl font-bold text-espresso mb-4">
            You&apos;re on the list
          </h1>

          <p className="text-text-muted text-base sm:text-lg leading-relaxed mb-6">
            Signalera is in private beta, opening access in small waves. You are on the list, and we will reach out when your access is ready.
          </p>

          <p className="text-text-muted text-sm mb-8">
            If you believe you should already have access, email{" "}
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
