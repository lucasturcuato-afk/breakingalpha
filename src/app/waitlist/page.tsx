import Link from "next/link"
import { Wordmark } from "@/components/ui/wordmark"

// Server component so it can read ?existing=1 off the (async) searchParams and
// render the duplicate variant. A duplicate arrival (already on the waitlist
// before this attempt) is routed here with ?existing=1 by the callback and the
// email/password paths; everyone else sees the standard new copy.
export default async function WaitlistPage({
  searchParams,
}: {
  searchParams: Promise<{ existing?: string | string[] }>
}) {
  const params = await searchParams
  const existing = params.existing === "1"

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

          {existing ? (
            <>
              <h1 className="font-serif text-2xl sm:text-3xl font-bold text-espresso mb-4">
                You&apos;re already on the list.
              </h1>

              <p className="text-text-muted text-base sm:text-lg leading-relaxed mb-3">
                No need to sign up twice, we have you. Access opens in small
                waves, and we will reach out when yours is ready.
              </p>

              <p className="text-text-muted text-base sm:text-lg leading-relaxed mb-6">
                We are building fast.
              </p>
            </>
          ) : (
            <>
              <h1 className="font-serif text-2xl sm:text-3xl font-bold text-espresso mb-4">
                You&apos;re on the list.
              </h1>

              <p className="text-text-muted text-base sm:text-lg leading-relaxed mb-3">
                Access opens in small waves. We will reach out when yours is
                ready.
              </p>

              <p className="text-text-muted text-base sm:text-lg leading-relaxed mb-6">
                Check your inbox, we just sent you a note.
              </p>
            </>
          )}

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
