"use client";

import Link from "next/link";

export function Footer() {
  return (
    <footer
      style={{
        borderTop: "1px solid var(--border-base)",
        background: "var(--cream)",
        padding: "20px 32px",
        marginTop: "auto",
      }}
    >
      <div
        className="font-sans"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
          fontSize: 11,
          color: "var(--text-muted)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
          <span>&copy; 2026 Signalera</span>
          <Link
            href="/legal/terms"
            className="hover:text-gold-dark transition-colors"
            style={{ textDecoration: "none", color: "inherit" }}
          >
            Terms of Service
          </Link>
          <Link
            href="/legal/privacy"
            className="hover:text-gold-dark transition-colors"
            style={{ textDecoration: "none", color: "inherit" }}
          >
            Privacy Policy
          </Link>
          <a
            href="mailto:admin@signalera.ai"
            className="hover:text-gold-dark transition-colors"
            style={{ textDecoration: "none", color: "inherit" }}
          >
            Support
          </a>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10 }}>
          <span style={{ fontStyle: "italic", maxWidth: 360, textAlign: "right" }}>
            AI-generated content. Not investment advice. Verify before acting.
          </span>
        </div>
      </div>
    </footer>
  );
}
