import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-parchment flex items-center justify-center px-4">
      <div className="text-center">
        <p className="font-data text-[64px] font-bold text-border-base">404</p>
        <h1 className="font-display text-[22px] font-extrabold text-espresso mt-2 mb-2">
          Page Not Found
        </h1>
        <p className="font-sans text-[13px] text-text-muted mb-6">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-gold text-cream font-sans text-[13px] font-semibold hover:bg-gold-dark transition-colors"
        >
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
