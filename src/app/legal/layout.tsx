import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Footer } from "@/components/shell/footer";

export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <header
        className="font-sans"
        style={{
          borderBottom: "1px solid var(--border-base)",
          background: "var(--cream)",
          padding: "16px 32px",
        }}
      >
        <div className="max-w-3xl mx-auto">
          <Link
            href="/"
            className="inline-flex items-center gap-2 hover:text-gold-dark transition-colors"
            style={{
              color: "var(--text-muted)",
              fontSize: 13,
              textDecoration: "none",
            }}
          >
            <ChevronLeft size={16} />
            <span
              className="font-[family-name:var(--font-playfair-display)] font-bold text-espresso"
              style={{ fontSize: 18 }}
            >
              Signalera
            </span>
          </Link>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
