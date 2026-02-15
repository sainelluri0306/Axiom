"use client";

import { useState } from "react";
import Link from "next/link";

type PageResultItem = {
  date: string;
  link: string;
  title: string;
  snippet: string | null;
  source: string;
};
type TimelineNode = {
  label: string;
  date: string;
  description: string;
  link: string;
};

type UrlAnalysisBody = {
  verdict?: string;
  score?: number;
  explanation?: string;
  timeline?: TimelineNode[];
  pageResults?: PageResultItem[];
  scrapedContent?: { title: string; description: string; body: string };
  error?: string;
};

function getDomain(link: string): string {
  try {
    return new URL(link).hostname.replace(/^www\./, "");
  } catch {
    return "Source";
  }
}

export default function TestUrlPage() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [rawResponse, setRawResponse] = useState<{
    status: number;
    ok: boolean;
    body: UrlAnalysisBody;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setRawResponse(null);
    setLoading(true);
    try {
      const res = await fetch("/api/analyze-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = (await res.json()) as UrlAnalysisBody;
      setRawResponse({ status: res.status, ok: res.ok, body: data });
      if (!res.ok) setError(data.error ?? "Request failed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
      setRawResponse(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-noir-bg text-zinc-100 p-6 font-sans">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-4 flex-wrap">
          <Link href="/" className="text-zinc-400 hover:text-white text-sm">
            ← Home
          </Link>
          <Link href="/test" className="text-zinc-400 hover:text-white text-sm">
            /test (image)
          </Link>
          <Link href="/test-text" className="text-zinc-400 hover:text-white text-sm">
            /test-text (claim)
          </Link>
          <h1 className="text-xl font-display tracking-wide">URL / Article — Test</h1>
        </div>

        <p className="text-sm text-zinc-500">
          Paste a URL (news article, Twitter/X post, etc.). The page is scraped, then SerpAPI and
          Claude fact-check the content. Uses <code className="text-zinc-400">/api/analyze-url</code>.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="url" className="block text-sm text-zinc-500 mb-1">
              URL
            </label>
            <input
              id="url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://twitter.com/... or https://www.bbc.com/..."
              className="w-full rounded bg-white/5 border border-white/10 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-white/20"
              required
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {loading ? "Scraping & analyzing…" : "Analyze"}
          </button>
        </form>

        {error && (
          <div className="rounded border border-red-500/50 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {error}
          </div>
        )}

        {rawResponse !== null && rawResponse.ok && (
          <div className="space-y-4">
            <h2 className="text-sm font-medium text-zinc-400">Fact-check result</h2>
            <div className="grid grid-cols-1 gap-3">
              {/* Scraped content preview */}
              {rawResponse.body.scrapedContent &&
                (rawResponse.body.scrapedContent.title ||
                  rawResponse.body.scrapedContent.description) && (
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                    <span className="text-xs uppercase tracking-wider text-zinc-500 block mb-2">
                      Scraped from URL
                    </span>
                    {rawResponse.body.scrapedContent.title && (
                      <p className="text-zinc-100 font-medium mb-1">
                        {rawResponse.body.scrapedContent.title}
                      </p>
                    )}
                    {rawResponse.body.scrapedContent.description && (
                      <p className="text-sm text-zinc-400 line-clamp-3">
                        {rawResponse.body.scrapedContent.description}
                      </p>
                    )}
                  </div>
                )}

              {/* Verdict box */}
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 flex flex-col gap-2">
                <span className="text-xs uppercase tracking-wider text-zinc-500">Verdict</span>
                <p className="text-zinc-100 font-medium">{rawResponse.body.verdict ?? "—"}</p>
                {(() => {
                  const verdict = (rawResponse.body.verdict ?? "").toUpperCase();
                  const score = rawResponse.body.score ?? 0;
                  const isTrueVerdict =
                    verdict.includes("TRUE") && !verdict.includes("FALSE");
                  const isUnverifiable =
                    verdict.includes("UNVERIFIED") ||
                    verdict.includes("TOO RECENT") ||
                    verdict.includes("MIXED") ||
                    verdict.includes("NO EVIDENCE") ||
                    verdict.includes("INSUFFICIENT") ||
                    verdict.includes("INVALID");
                  if (isUnverifiable) {
                    return (
                      <div>
                        <p className="text-sm text-amber-400/90 font-medium">
                          Not enough information to verify
                        </p>
                        <p className="text-xs text-zinc-500 mt-1">
                          We don&apos;t have enough info to verify this claim.
                        </p>
                      </div>
                    );
                  }
                  const displayPct = isTrueVerdict ? 100 - score : score;
                  const label = isTrueVerdict ? "Accuracy" : "False / misleading";
                  return (
                    <div>
                      <p className="text-2xl font-display text-white">{displayPct}%</p>
                      <p className="text-xs text-zinc-500">{label}</p>
                    </div>
                  );
                })()}
                {rawResponse.body.explanation && (
                  <p className="text-sm text-zinc-400 whitespace-pre-wrap mt-2">
                    {rawResponse.body.explanation}
                  </p>
                )}
              </div>

              {/* Timeline */}
              {rawResponse.body.timeline &&
                rawResponse.body.timeline.length > 0 && (
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                    <span className="text-xs uppercase tracking-wider text-zinc-500 block mb-4">
                      Timeline — findings
                    </span>
                    <div className="relative flex flex-col pl-0">
                      <div
                        className="absolute left-[calc(5.5rem+1rem+12px)] top-6 bottom-6 w-px bg-zinc-600"
                        aria-hidden
                      />
                      {rawResponse.body.timeline.map((node, i) => (
                        <div
                          key={i}
                          className="grid grid-cols-[5.5rem_24px_1fr] gap-4 items-start py-4 first:pt-0 last:pb-0"
                        >
                          <div className="rounded-md bg-white/95 px-2 py-1.5 text-center shrink-0 min-w-0">
                            <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-800 whitespace-nowrap block">
                              {node.date}
                            </span>
                          </div>
                          <div className="relative flex justify-center pt-1.5 shrink-0">
                            <div
                              className="relative z-10 h-3 w-3 shrink-0 rounded-full border-2 border-zinc-500 bg-noir-bg"
                              aria-hidden
                            />
                          </div>
                          <div className="min-w-0 pl-2">
                            <p className="text-xs uppercase tracking-wider text-zinc-500 mb-0.5">
                              {node.label}
                            </p>
                            <p className="text-sm text-zinc-400 leading-relaxed">
                              {node.description}
                            </p>
                            {node.link && (
                              <a
                                href={node.link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-zinc-500 hover:text-zinc-400 transition-colors block mt-1"
                              >
                                Source: {getDomain(node.link)}
                              </a>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              {/* Sources */}
              {rawResponse.body.pageResults &&
                rawResponse.body.pageResults.length > 0 && (
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                    <span className="text-xs uppercase tracking-wider text-zinc-500 block mb-3">
                      Sources (Web, News, PolitiFact, Snopes)
                    </span>
                    <ul className="space-y-2">
                      {rawResponse.body.pageResults.slice(0, 12).map((p, i) => (
                        <li key={i} className="text-sm">
                          <span className="text-zinc-500 text-xs uppercase mr-2">
                            [{p.source}]
                          </span>
                          <a
                            href={p.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-zinc-300 hover:text-white transition-colors"
                          >
                            {p.title}
                          </a>
                          {p.snippet && (
                            <p className="text-zinc-500 text-xs mt-0.5 line-clamp-2">
                              {p.snippet}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
            </div>
          </div>
        )}

        {rawResponse !== null && (
          <div>
            <h2 className="text-sm font-medium text-zinc-400 mb-2">Response (raw)</h2>
            <pre className="rounded border border-white/10 bg-black/40 p-4 text-xs text-zinc-300 overflow-x-auto whitespace-pre-wrap break-words max-h-96 overflow-y-auto">
              {JSON.stringify(rawResponse, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
