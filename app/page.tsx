"use client";

import Link from "next/link";
import Nav from "@/components/Nav";
import HeroInput from "@/components/HeroInput";

export default function Home() {
  return (
    <>
      <div className="noir-bg-base min-h-screen">
        <div className="grain-overlay" aria-hidden="true" />
        <div className="relative z-10 flex min-h-screen flex-col">
        <Nav />

        <main className="relative flex flex-1 flex-col items-center justify-center px-4 py-12 sm:px-6 sm:py-16">
          <div className="mx-auto flex w-full max-w-2xl flex-col items-center text-center">
          {/* Announcement pill */}
          <Link
            href="#new"
            className="mb-8 flex items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.03] px-4 py-2 text-sm transition-colors hover:bg-white/[0.05]"
          >
            <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-medium tracking-wide text-zinc-300">
              New
            </span>
            <span className="text-zinc-400">Introducing Paper Trails</span>
            <svg className="h-4 w-4 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>

          {/* Headline — 2 lines, elegant, premium */}
          <header className="space-y-5">
            <h1 className="font-display text-4xl font-normal leading-[1.15] tracking-tight text-white sm:text-5xl lg:text-[3.25rem] lg:leading-[1.2]">
              Your provenance engine
              <br />
              for the internet.
            </h1>
            <p className="mx-auto max-w-md text-sm tracking-wide text-zinc-500 sm:text-base">
              Trace origin. Verify provenance. Understand context.
            </p>
          </header>

          {/* Input bar */}
          <div className="mt-10 w-full max-w-2xl sm:mt-12">
            <HeroInput />
          </div>
          </div>

          {/* Scroll indicator */}
          <a
            href="#below"
            className="absolute bottom-8 left-1/2 -translate-x-1/2 text-zinc-600 hover:text-zinc-400 transition-colors"
            aria-label="Scroll down"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          </a>
        </main>

        <div id="below" className="h-px" />
        </div>
      </div>
    </>
  );
}
