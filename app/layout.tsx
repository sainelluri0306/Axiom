import type { Metadata } from "next";
import { Special_Elite, Inter } from "next/font/google";
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
    <html lang="en" className={`${display.variable} ${sans.variable}`}>
      <body className="font-sans antialiased bg-noir-bg text-zinc-100 min-h-screen">
        {children}
      </body>
    </html>
  );
}
