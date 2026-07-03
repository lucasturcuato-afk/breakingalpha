import type { Metadata, Viewport } from "next";
import { Newsreader, Inter, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { UserProfileProvider } from "@/hooks/useUserProfile";
import { SignaleraTour, TourHelpButton } from "@/components/tour/SignaleraTour";
import "./globals.css";

// Display serif swapped Playfair Display -> Newsreader (visual-identity spec §1):
// a sturdy, low-contrast text serif that reads authoritative rather than glam.
// The CSS var name is kept as --font-playfair-display so every existing
// reference (globals.css h1/h2, .font-display, component font-[family-name:...])
// inherits the swap with zero churn. Weights 400/500/600 per spec, plus 700 to
// preserve existing bold display headings (option A).
const displaySerif = Newsreader({
  variable: "--font-playfair-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
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
    <html
      lang="en"
      className={`${displaySerif.variable} ${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
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
