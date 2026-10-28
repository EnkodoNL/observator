// SPDX-License-Identifier: FSL-1.1-ALv2
import type { Metadata } from "next";
import { Atkinson_Hyperlegible, Bricolage_Grotesque, Martian_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

// Everything is per-user and backed by live data; never prerender at build time.
export const dynamic = "force-dynamic";

// Downloaded at build time and served from this app: no request to Google at runtime.
const body = Atkinson_Hyperlegible({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-atkinson",
});
const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-bricolage" });
const mono = Martian_Mono({ subsets: ["latin"], variable: "--font-martian" });

export const metadata: Metadata = {
  title: { default: "Observator", template: "%s · Observator" },
  description: "Self-hosted monitor for the runtime versions and packages your containers really run.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${body.variable} ${display.variable} ${mono.variable} h-full antialiased`}
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
