"use client";

import Link from "next/link";
import PaperTrailsLogo from "./PaperTrailsLogo";

const navLinks = [
  { href: "#cases", label: "Cases" },
  { href: "#reports", label: "Reports" },
  { href: "#about", label: "About" },
  { href: "#pricing", label: "Pricing" },
];

export default function Nav() {
  return (
    <header
      className="sticky top-0 z-40 w-full border-b border-white/[0.06] bg-black/40 backdrop-blur-xl"
      role="banner"
    >
      <nav
        className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8"
        aria-label="Main navigation"
      >
        {/* Left: logo + icon */}
        <Link
          href="/"
          className="flex items-center gap-2 text-zinc-100 hover:text-white transition-colors"
          aria-label="Paper Trails home"
        >
          <PaperTrailsLogo className="h-8 w-auto min-w-[8rem]" underlineDuration={0.7} />
        </Link>

        {/* Center: nav links with chevrons */}
        <ul className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-8 sm:flex" role="list">
          {navLinks.map(({ href, label }) => (
            <li key={href}>
              <Link
                href={href}
                className="flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                {label}
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </Link>
            </li>
          ))}
        </ul>

        {/* Right: icon + Login pill */}
        <div className="flex items-center gap-3">
          <span
            className="h-2 w-2 rounded-full bg-white/60"
            aria-hidden="true"
            title="System operational"
          />
          <Link
            href="#signin"
            className="rounded-full bg-white/95 px-4 py-2 text-sm font-medium text-black transition-all hover:bg-white"
          >
            Login
          </Link>
        </div>
      </nav>
    </header>
  );
}
