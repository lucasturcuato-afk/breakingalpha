import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service — Signalera",
  description: "Terms governing your use of Signalera.",
};

export default function TermsOfServicePage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <article className="prose prose-stone max-w-none font-sans text-text-primary">
        <h1 className="font-[family-name:var(--font-playfair-display)] text-espresso text-4xl font-bold mb-2">
          Terms of Service
        </h1>
        <p className="text-sm text-text-muted mb-8">
          <strong>Last Updated:</strong> April 27, 2026
        </p>

        <p>
          These Terms of Service (&ldquo;Terms&rdquo;) govern your use of Signalera (the &ldquo;Service&rdquo;), operated at breakingalpha.vercel.app. By accessing or using the Service, you agree to be bound by these Terms. If you do not agree, do not use the Service.
        </p>

        <h2>1. Beta Software</h2>
        <p>
          Signalera is currently in beta. The Service is provided as-is, may contain bugs, may be temporarily unavailable, and may change significantly or be discontinued without notice. Features and pricing may change at any time. Beta access is offered free of charge.
        </p>

        <h2>2. NOT INVESTMENT ADVICE — IMPORTANT</h2>
        <p>
          <strong>Signalera is an informational tool. It is not an investment advisor, broker-dealer, or financial planner.</strong>
        </p>
        <p>
          Nothing in the Service constitutes investment advice, a recommendation to buy or sell any security, or a solicitation of any kind. The Service provides AI-generated summaries, analyses, and pattern detection based on publicly available financial news and market data. This content is for informational and educational purposes only.
        </p>
        <p>You are solely responsible for your investment decisions. Before making any investment, you should:</p>
        <ul>
          <li>Conduct your own independent research</li>
          <li>Consult with a licensed financial advisor</li>
          <li>Consider your own financial situation, risk tolerance, and goals</li>
        </ul>
        <p>
          We make no representation or warranty as to the accuracy, completeness, or timeliness of any information provided through the Service. Past performance does not guarantee future results. All investments carry risk of loss.
        </p>

        <h2>3. AI-Generated Content</h2>
        <p>
          The Service uses artificial intelligence to generate written content, including but not limited to morning briefs, evening wraps, theses, memos, and chat responses. AI-generated content may contain errors, inaccuracies, hallucinations, outdated information, or misinterpretations. You should independently verify any information before relying on it.
        </p>
        <p>
          We do not guarantee the accuracy of AI-generated content. By using the Service, you accept that AI output is inherently imperfect and you assume all risk associated with relying on such content.
        </p>

        <h2>4. Eligibility</h2>
        <p>
          To use the Service, you must be at least 18 years old (or the age of majority in your jurisdiction). By using the Service, you represent that you meet this requirement.
        </p>

        <h2>5. Account Registration</h2>
        <p>You must create an account to access most features. You agree to:</p>
        <ul>
          <li>Provide accurate, current, and complete information during registration</li>
          <li>Keep your account credentials (managed via Google OAuth) secure</li>
          <li>Notify us immediately of any unauthorized access to your account</li>
          <li>Be responsible for all activity under your account</li>
        </ul>
        <p>We may suspend or terminate accounts that violate these Terms or that appear to be abusive, fraudulent, or automated.</p>

        <h2>6. Acceptable Use</h2>
        <p>You agree not to:</p>
        <ul>
          <li>Use the Service for any unlawful purpose</li>
          <li>Attempt to circumvent rate limits, access controls, or security measures</li>
          <li>Reverse-engineer, decompile, or extract the source code of the Service</li>
          <li>Scrape, harvest, or systematically extract data from the Service except as expressly permitted</li>
          <li>Use the Service to develop a competing product</li>
          <li>Use the Service to harass, threaten, or harm others</li>
          <li>Upload malicious code, viruses, or any code designed to disrupt the Service</li>
          <li>Resell or redistribute Service content without our written permission</li>
          <li>Misrepresent your identity or affiliation</li>
        </ul>

        <h2>7. Intellectual Property</h2>
        <p>
          The Service, including all software, design, and AI-generated content displayed within it, is owned by Signalera and its licensors. You may view, copy, and use Service content for your personal, non-commercial use. You may not republish, redistribute, or commercially exploit Service content without our written permission.
        </p>
        <p>Market data is provided by third-party sources (e.g., Finnhub) and is subject to those sources&rsquo; terms.</p>

        <h2>8. User Content</h2>
        <p>
          You retain ownership of any content you create within the Service (e.g., notes you write on theses, watchlist items you add). By creating such content, you grant us a non-exclusive, worldwide, royalty-free license to store, display, and process that content as necessary to operate the Service for you.
        </p>
        <p>
          You are responsible for the content you create. Do not upload content that is illegal, infringing, defamatory, or that violates anyone&rsquo;s rights.
        </p>

        <h2>9. Privacy</h2>
        <p>
          Our collection and use of information about you is governed by our <a href="/legal/privacy">Privacy Policy</a>.
        </p>

        <h2>10. Disclaimers</h2>
        <p>
          THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE&rdquo; WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS, IMPLIED, OR STATUTORY, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, NON-INFRINGEMENT, OR ACCURACY.
        </p>
        <p>WE DO NOT WARRANT THAT:</p>
        <ul>
          <li>The Service will be uninterrupted, timely, secure, or error-free</li>
          <li>Information provided through the Service will be accurate or reliable</li>
          <li>Any defects in the Service will be corrected</li>
          <li>The Service will meet your specific needs</li>
        </ul>

        <h2>11. Limitation of Liability</h2>
        <p>
          TO THE MAXIMUM EXTENT PERMITTED BY LAW, SIGNALERA AND ITS OPERATORS SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED TO LOSS OF PROFITS, LOSS OF DATA, OR LOSS OF INVESTMENT VALUE, ARISING FROM OR RELATED TO YOUR USE OF THE SERVICE.
        </p>
        <p>
          IN NO EVENT WILL OUR TOTAL LIABILITY EXCEED ONE HUNDRED U.S. DOLLARS ($100), OR THE AMOUNT YOU PAID US IN THE TWELVE MONTHS PRECEDING THE CLAIM, WHICHEVER IS GREATER. SINCE THE SERVICE IS CURRENTLY FREE, OUR LIABILITY IS LIMITED TO ONE HUNDRED U.S. DOLLARS ($100).
        </p>
        <p>
          YOU EXPRESSLY ACKNOWLEDGE THAT YOU ARE USING AN INFORMATIONAL TOOL AND THAT WE ARE NOT LIABLE FOR ANY INVESTMENT LOSSES YOU MAY INCUR.
        </p>

        <h2>12. Indemnification</h2>
        <p>
          You agree to indemnify and hold harmless Signalera and its operators from any claim, demand, or damages arising from your use of the Service, your violation of these Terms, or your violation of any third party&rsquo;s rights.
        </p>

        <h2>13. Termination</h2>
        <p>
          We may suspend or terminate your access to the Service at any time, with or without cause, with or without notice. You may stop using the Service and delete your account at any time by emailing lucasturcuato@gmail.com.
        </p>
        <p>Upon termination, sections 7, 8, 10, 11, 12, 14, and 15 will survive.</p>

        <h2>14. Governing Law and Dispute Resolution</h2>
        <p>
          These Terms are governed by the laws of the State of California, United States, without regard to conflict of law principles.
        </p>
        <p>
          Any dispute arising from these Terms or your use of the Service will be resolved through binding individual arbitration administered by JAMS in Los Angeles County, California, under JAMS&rsquo; applicable rules. You waive any right to participate in a class action.
        </p>
        <p>
          If arbitration is unavailable, exclusive jurisdiction lies with the state and federal courts located in Los Angeles County, California, and you consent to personal jurisdiction in those courts.
        </p>

        <h2>15. Miscellaneous</h2>
        <ul>
          <li><strong>Entire agreement.</strong> These Terms, together with the Privacy Policy, constitute the entire agreement between you and Signalera regarding the Service.</li>
          <li><strong>Severability.</strong> If any provision is held unenforceable, the remaining provisions remain in effect.</li>
          <li><strong>Waiver.</strong> Our failure to enforce any right under these Terms is not a waiver of that right.</li>
          <li><strong>Assignment.</strong> You may not assign these Terms. We may assign them in connection with a merger, acquisition, or sale.</li>
          <li><strong>Changes.</strong> We may update these Terms from time to time. We will post the updated version with a new &ldquo;Last Updated&rdquo; date. Material changes will be communicated where reasonable. Continued use after changes constitutes acceptance.</li>
        </ul>

        <h2>16. Contact</h2>
        <p>Questions about these Terms? Contact:</p>
        <p>
          Signalera<br />
          Email: <a href="mailto:lucasturcuato@gmail.com">lucasturcuato@gmail.com</a>
        </p>
      </article>
    </div>
  );
}
