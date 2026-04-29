import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — Signalera",
  description: "How Signalera collects, uses, and protects your information.",
};

export default function PrivacyPolicyPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <article className="prose prose-stone max-w-none font-sans text-text-primary">
        <h1 className="font-[family-name:var(--font-playfair-display)] text-espresso text-4xl font-bold mb-2">
          Privacy Policy
        </h1>
        <p className="text-sm text-text-muted mb-8">
          <strong>Last Updated:</strong> April 27, 2026
        </p>

        <p>
          This Privacy Policy describes how Signalera (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;) collects,
          uses, and shares information when you use our service at
          breakingalpha.vercel.app (the &ldquo;Service&rdquo;). By using the Service, you agree
          to the collection and use of information in accordance with this policy.
        </p>
        <p>Signalera is currently in beta and provided free of charge.</p>

        <h2>1. Information We Collect</h2>

        <h3>Information you provide</h3>
        <p>When you sign up for an account through Google OAuth, we receive:</p>
        <ul>
          <li>Your email address</li>
          <li>Your name as provided by your Google account</li>
          <li>A unique account identifier</li>
        </ul>
        <p>When you use the Service, you may provide additional information by:</p>
        <ul>
          <li>Adding tickers to your watchlist</li>
          <li>Saving research notes on theses</li>
          <li>Completing onboarding preferences (sectors, risk appetite, investment horizon, workflow style, role)</li>
        </ul>

        <h3>Information collected automatically</h3>
        <p>We automatically collect certain usage information when you interact with the Service:</p>
        <ul>
          <li>Pages you view and features you use (e.g., opening a morning brief, viewing a thesis)</li>
          <li>Timestamps of your activity</li>
          <li>Browser type and general device information</li>
        </ul>
        <p>We do NOT collect:</p>
        <ul>
          <li>Your precise location</li>
          <li>Your financial account information</li>
          <li>Your contacts</li>
          <li>Information from other websites you visit</li>
        </ul>

        <h3>Cookies</h3>
        <p>
          We use cookies only as necessary to keep you signed in to your account. These authentication cookies are managed by our auth provider (Supabase). We do not currently use third-party advertising cookies, marketing trackers, or analytics cookies. If we add analytics in the future, we will update this policy.
        </p>

        <h2>2. How We Use Your Information</h2>
        <p>We use the information we collect to:</p>
        <ul>
          <li>Provide and maintain the Service</li>
          <li>Personalize your morning briefs, evening wraps, and thesis recommendations based on your stated preferences and behavioral signals</li>
          <li>Send you Service-related communications (e.g., account verification)</li>
          <li>Improve the Service by analyzing aggregate usage patterns</li>
          <li>Detect and prevent fraud, abuse, or technical issues</li>
        </ul>
        <p>We do NOT:</p>
        <ul>
          <li>Sell your personal information</li>
          <li>Share your personal information with third parties for marketing</li>
          <li>Use your information to make automated decisions with legal effects on you</li>
        </ul>

        <h2>3. AI-Generated Content</h2>
        <p>
          The Service uses artificial intelligence (specifically, Google Gemini) to generate market summaries, analyses, and other content. When you use AI features such as the Intelligence Chat or Memo Generator, the content of your queries may be sent to Google&rsquo;s Gemini API for processing.
        </p>
        <p>
          We do not send your name, email, or account identifier to Gemini. We send only the content of your specific request. Google&rsquo;s handling of this data is governed by Google&rsquo;s own terms (see Section 4).
        </p>

        <h2>4. Third-Party Services</h2>
        <p>We use the following third-party services to operate the Service. Each has its own privacy practices, which we encourage you to review:</p>
        <ul>
          <li>
            <strong>Supabase</strong> — database hosting and authentication.{" "}
            <a href="https://supabase.com/privacy" target="_blank" rel="noopener noreferrer">
              https://supabase.com/privacy
            </a>
          </li>
          <li>
            <strong>Vercel</strong> — application hosting and deployment.{" "}
            <a href="https://vercel.com/legal/privacy-policy" target="_blank" rel="noopener noreferrer">
              https://vercel.com/legal/privacy-policy
            </a>
          </li>
          <li>
            <strong>Google (OAuth and Gemini AI)</strong> — sign-in and AI content generation.{" "}
            <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">
              https://policies.google.com/privacy
            </a>
          </li>
          <li>
            <strong>Finnhub</strong> — market data and stock quotes.{" "}
            <a href="https://finnhub.io/privacy" target="_blank" rel="noopener noreferrer">
              https://finnhub.io/privacy
            </a>
          </li>
        </ul>
        <p>We do not control the privacy practices of these services.</p>

        <h2>5. Data Retention</h2>
        <p>
          We retain your account information for as long as your account is active. You may delete your account at any time by emailing lucasturcuato@gmail.com. Upon deletion, we will remove your personal information from our active databases within 30 days, though copies may persist in encrypted backups for an additional period before being overwritten in the normal course of operations.
        </p>
        <p>Aggregated, anonymized data that cannot be linked back to you may be retained indefinitely.</p>

        <h2>6. Your Rights</h2>
        <p>Depending on where you live, you may have the right to:</p>
        <ul>
          <li>Access the personal information we hold about you</li>
          <li>Correct inaccurate information</li>
          <li>Delete your information</li>
          <li>Object to or restrict certain processing</li>
        </ul>
        <p>
          If you are a California resident, the California Consumer Privacy Act (CCPA) provides you with these rights. We do not sell personal information, so we do not currently offer an opt-out of sale.
        </p>
        <p>To exercise any of these rights, email lucasturcuato@gmail.com. We will respond within 30 days.</p>

        <h2>7. Security</h2>
        <p>
          We use industry-standard security practices to protect your information, including encrypted connections (HTTPS), encrypted database storage, and access controls on our infrastructure. However, no system is perfectly secure, and we cannot guarantee absolute security. You are responsible for keeping your Google account credentials secure.
        </p>
        <p>If we become aware of a security incident affecting your information, we will notify you in accordance with applicable law.</p>

        <h2>8. Children</h2>
        <p>
          The Service is not directed to anyone under 13 years of age. We do not knowingly collect personal information from children under 13. If you believe a child under 13 has provided us with personal information, please contact us so we can remove it.
        </p>

        <h2>9. International Users</h2>
        <p>
          The Service is operated from the United States. If you access the Service from outside the United States, your information will be transferred to, stored in, and processed in the United States. By using the Service, you consent to this transfer.
        </p>

        <h2>10. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. When we do, we will post the updated version with a new &ldquo;Last Updated&rdquo; date. For material changes, we will make reasonable efforts to notify you (e.g., by email).
        </p>

        <h2>11. Contact</h2>
        <p>If you have questions about this Privacy Policy, contact:</p>
        <p>
          Signalera<br />
          Email: <a href="mailto:lucasturcuato@gmail.com">lucasturcuato@gmail.com</a>
        </p>
      </article>
    </div>
  );
}
