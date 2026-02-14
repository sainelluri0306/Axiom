"use client";

export default function HeroInput() {
  return (
    <div
      className="flex w-full max-w-2xl items-center gap-2 rounded-full bg-white/[0.03] px-3 py-2 transition-all duration-200 hover:bg-white/[0.05]"
      style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03), 0 1px 2px rgba(0,0,0,0.2)" }}
      role="search"
    >
      {/* Left: link icon — circular */}
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.05] text-zinc-500">
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
        </svg>
      </span>

      {/* Input — no border, no focus ring highlight */}
      <label htmlFor="hero-search" className="sr-only">URL or content to trace</label>
      <input
        id="hero-search"
        type="text"
        placeholder="Ask Paper Trails to trace origin..."
        className="hero-input min-h-[44px] flex-1 bg-transparent text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-0"
      />

      {/* Upload icon */}
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-500 hover:text-zinc-300 transition-colors" aria-hidden="true">
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>
      </span>

      {/* CTA — elegant minimal: soft white */}
      <button
        type="button"
        className="rounded-full bg-white/95 px-5 py-2.5 text-sm font-semibold text-black transition-all hover:bg-white"
      >
        Get Started
      </button>
    </div>
  );
}
