// SPDX-License-Identifier: FSL-1.1-ALv2
import type { Metadata } from "next";
import { Instrument_Sans, Instrument_Serif } from "next/font/google";
import { GeistMono } from "geist/font/mono";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

// Everything is per-user and backed by live data; never prerender at build time.
export const dynamic = "force-dynamic";

// Downloaded at build time and served from this app: no request to Google at runtime.
const sans = Instrument_Sans({ subsets: ["latin"], variable: "--font-instrument-sans" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", variable: "--font-instrument-serif" });

export const metadata: Metadata = {
  title: { default: "Observator", template: "%s · Observator" },
  description: "Self-hosted monitor for the runtime versions and packages your containers really run.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${sans.variable} ${serif.variable} ${GeistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <TooltipProvider>{children}</TooltipProvider>
          <Toaster position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
