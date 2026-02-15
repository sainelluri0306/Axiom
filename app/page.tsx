"use client";

import { useState } from "react";
import Link from "next/link";
import Nav from "@/components/Nav";
import HeroInput from "@/components/HeroInput";

type TimelineNode = {
  label: string;
  date: string;
  description: string;
  link: string;
};

type AnalysisResult = {
  verdict: string;
  score: number;
  explanation: string;
  timeline?: TimelineNode[];
  imageHistory?: {
    knowledgeGraphTitle: string | null;
    visualMatches: Array<{ source: string; title: string; date: string }>;
  };
};

export default function Home() {
  const [imageUrl, setImageUrl] = useState("");
  const [userClaim, setUserClaim] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleInvestigate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl, userClaim }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Analysis failed");
        return;
      }
      setResult(data as AnalysisResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="noir-bg-base min-h-screen">
        <div className="grain-overlay" aria-hidden="true" />
        <div className="relative z-10 flex min-h-screen flex-col">
          <Nav />

          <main className="relative flex flex-1 flex-col items-center justify-center px-4 py-12 sm:px-6 sm:py-16">
            <div className="mx-auto flex w-full max-w-2xl flex-col items-center text-center">
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

              <div className="mt-10 w-full max-w-2xl sm:mt-12">
                <HeroInput />
              </div>

              {/* Context forensics: Image URL + Claim → INVESTIGATE */}
              <section className="mt-16 w-full max-w-2xl text-left">
                <h2 id="analyze" className="font-display text-lg tracking-wide text-zinc-300 mb-4">
                  Context forensics
                </h2>
                <form onSubmit={handleInvestigate} className="space-y-4">
                  <div>
                    <label htmlFor="image-url" className="block text-sm text-zinc-500 mb-1">Image URL</label>
                    <input
                      id="image-url"
                      type="url"
                      value={imageUrl}
                      onChange={(e) => setImageUrl(e.target.value)}
                      placeholder="https://..."
                      className="w-full rounded-lg bg-white/[0.03] border border-white/10 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-white/20"
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="user-claim" className="block text-sm text-zinc-500 mb-1">Claim</label>
                    <input
                      id="user-claim"
                      type="text"
                      value={userClaim}
                      onChange={(e) => setUserClaim(e.target.value)}
                      placeholder="e.g. Paris Riots 2026"
                      className="w-full rounded-lg bg-white/[0.03] border border-white/10 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-white/20"
                      required
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full rounded-lg bg-red-600 px-4 py-3 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {loading ? "Scanning Archives..." : "INVESTIGATE"}
                  </button>
                </form>

                {error && (
                  <p className="mt-4 text-sm text-red-400" role="alert">{error}</p>
                )}

                {result && (
                  <div className="mt-8 rounded-lg border border-white/10 bg-white/[0.02] p-4 text-left">
                    <h3 className="font-display text-sm uppercase tracking-wider text-zinc-400">Verdict</h3>
                    <p className="mt-1 text-lg font-medium text-white">{result.verdict}</p>
                    <p className="mt-2 text-3xl font-display text-white">Fake Score: {result.score}%</p>
                    <p className="mt-2 text-sm text-zinc-400">{result.explanation}</p>
                    {result.timeline && result.timeline.length > 0 && (
                      <div className="mt-4">
                        <h4 className="text-sm text-zinc-500 uppercase tracking-wider">Timeline</h4>
                        <ul className="mt-2 space-y-2">
                          {result.timeline.map((t, i) => (
                            <li key={i} className="text-sm text-zinc-300">
                              <span className="text-zinc-500">{t.date}</span> — <span className="font-medium text-zinc-200">{t.label}</span>: {t.description}
                              {t.link && (
                                <a href={t.link} target="_blank" rel="noopener noreferrer" className="ml-1 text-zinc-500 hover:text-zinc-400">↗</a>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </section>
            </div>

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
