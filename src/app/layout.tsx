import type { Metadata, Viewport } from "next";
import { Fraunces, Space_Grotesk, IBM_Plex_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { UserProfileProvider } from "@/hooks/useUserProfile";
import { SignaleraTour, TourHelpButton } from "@/components/tour/SignaleraTour";
import "./globals.css";

// Three-part type system:
//   Fraunces        serif voice for headlines and the lead story
//   Space Grotesk   sans for all UI, labels, and body copy
//   IBM Plex Mono   numbers, tickers, prices, dates (tabular figures)
// Weights are limited to 400 and 500. globals.css aliases the prior
// variable names (--font-playfair-display / --font-inter /
// --font-jetbrains-mono) onto these new families, so existing component
// references inherit the swap with zero per-file churn.
/*
  No `weight` array on the two variable families, deliberately.

  Fraunces and Space Grotesk are variable fonts. Naming discrete weights
  makes next/font emit one @font-face descriptor per weight, every one
  pointing at the SAME file, which forbids the browser from using the
  wght axis those bytes already carry. Verified in the built output:
  Fraunces emitted 6 descriptors across only 3 distinct files, 400 and
  500 both resolving to 03bda585a99c6450. Space Grotesk the same.

  Omitting `weight` selects the variable form, and with no `axes`
  argument next/font requests wght ONLY, so Fraunces's SOFT, WONK and
  opsz axes are not pulled in. Measured against the Google CSS API the
  payload is byte-identical: 400;500 and 100..900 both return the same
  3 files at 81,776 B. This costs nothing.

  IBM Plex Mono below keeps its array because it has no variable form.
  Its 10 descriptors resolve to 10 genuinely distinct files, and
  omitting `weight` would throw.
*/
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Signalera — Where Markets Make Sense",
  description: "Premium market intelligence platform",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fffdf9" },
    { media: "(prefers-color-scheme: dark)", color: "#080808" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <body
        className={`${fraunces.variable} ${spaceGrotesk.variable} ${plexMono.variable} min-h-full flex flex-col`}
        suppressHydrationWarning
      >
        <ThemeProvider>
          <UserProfileProvider>
            {children}
            <SignaleraTour />
            <TourHelpButton />
          </UserProfileProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
