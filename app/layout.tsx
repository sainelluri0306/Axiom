import type { Metadata } from "next";
import { Special_Elite, Inter, Jost } from "next/font/google";
import "./globals.css";

const display = Special_Elite({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const jost = Jost({
  subsets: ["latin"],
  variable: "--font-jost",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Paper Trails — Provenance for the Internet",
  description: "Provenance, timeline, and context for digital content.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${jost.variable}`}>
      <body className="font-sans antialiased bg-noir-bg text-zinc-100 min-h-screen flex flex-col">
        <div className="flex-1 pb-14">{children}</div>
        <footer className="fixed bottom-0 left-0 right-0 z-30 py-3 text-center text-sm text-zinc-400 bg-black/40 backdrop-blur-sm">
          Made with ❤️ by Team Axiom @ Hack_NCState 2026
        </footer>
      </body>
    </html>
  );
}
