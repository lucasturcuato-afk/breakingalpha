"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { Footer } from "@/components/shell/footer";

/**
 * The frame the three legal routes share.
 *
 * IT IS A CLIENT COMPONENT FOR EXACTLY ONE READ, and the read is `usePathname`.
 * The hub at `/legal` must not draw this footer, because the footer's three
 * links are Terms, Privacy and Support at 17.6px tall and the hub draws those
 * same three destinations at 56px directly above them. Two copies of one list,
 * the lower one under the tap floor, on a page whose entire job is that the
 * list is tappable. The two documents keep their footer exactly as it was.
 *
 * Nothing else here needs a client, and nothing else became one: the two
 * documents and the hub are still server components with their own `metadata`,
 * passed through `children`.
 *
 * THE MASTHEAD LINK CARRIES ITS OWN HIT AREA. It draws at 28.8px, which is
 * under the 44px floor on all three routes. The padding grows the hit box and
 * an equal negative margin gives the space straight back to the line box, so
 * the header is the height it always was. `content-box` is load-bearing: the
 * app sets `border-box` globally, under which the padding would eat the
 * content instead of adding to it. Proved differentially rather than asserted.
 */
export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isHub = pathname === "/legal";

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
              boxSizing: "content-box",
              color: "var(--text-muted)",
              fontSize: 13,
              padding: "8px 0",
              margin: "-8px 0",
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
      {isHub ? null : <Footer />}
    </div>
  );
}
