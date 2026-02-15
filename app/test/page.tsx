"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";

type PageResultItem = { date: string; link: string; title: string; snippet: string | null };
type AboutThisImageData = {
  headerTitle: string | null;
  headerImage: string | null;
  pageResults: PageResultItem[];
};
/** Timeline node from API (Claude-built; variable count). */
type TimelineNode = {
  label: string;
  date: string;
  description: string;
  link: string;
};

type AnalyzeBody = {
  verdict?: string;
  score?: number;
  explanation?: string;
  timeline?: TimelineNode[];
  aboutThisImage?: AboutThisImageData;
};

function getDomain(link: string): string {
  try {
    return new URL(link).hostname.replace(/^www\./, "");
  } catch {
    return "Source";
  }
}

export default function TestPage() {
  const [imageUrl, setImageUrl] = useState("");
  const [userClaim, setUserClaim] = useState("");
  const [loading, setLoading] = useState(false);
  const [rawResponse, setRawResponse] = useState<{ status: number; ok: boolean; body: AnalyzeBody & { error?: string } } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imageViewerUrl, setImageViewerUrl] = useState<string | null>(null);
  const timelineContainerRef = useRef<HTMLDivElement>(null);
  const firstMarkerRef = useRef<HTMLDivElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setRawResponse(null);
    setLoading(true);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl, userClaim }),
      });
      const data = await res.json() as AnalyzeBody & { error?: string };
      setRawResponse({ status: res.status, ok: res.ok, body: data });
      if (!res.ok) setError(data.error ?? "Request failed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
      setRawResponse(null);
    } finally {
      setLoading(false);
    }
  }

  // Measure the first marker's position and set CSS variable for line alignment
  useEffect(() => {
    const updateLinePosition = () => {
      if (firstMarkerRef.current && timelineContainerRef.current) {
        const markerRect = firstMarkerRef.current.getBoundingClientRect();
        const containerRect = timelineContainerRef.current.getBoundingClientRect();
        const markerCenterX = markerRect.left + markerRect.width / 2;
        const lineLeft = markerCenterX - containerRect.left;
        timelineContainerRef.current.style.setProperty('--timeline-line-left', `${lineLeft}px`);
      }
    };

    // Initial measurement with delay to ensure layout is complete
    const timeoutId = setTimeout(() => {
      requestAnimationFrame(updateLinePosition);
    }, 100);

    // Re-measure on resize
    const handleResize = () => {
      requestAnimationFrame(updateLinePosition);
    };
    window.addEventListener('resize', handleResize);

    // Use MutationObserver to detect when timeline content changes
    const observer = timelineContainerRef.current
      ? new MutationObserver(() => {
          requestAnimationFrame(updateLinePosition);
        })
      : null;

    if (timelineContainerRef.current && observer) {
      observer.observe(timelineContainerRef.current, {
        childList: true,
        subtree: true,
        attributes: false,
      });
    }

    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('resize', handleResize);
      if (observer) observer.disconnect();
    };
  }, [rawResponse]);

  return (
    <div className="min-h-screen bg-noir-bg text-zinc-100 p-6 font-sans">
      {/* Image viewer overlay: click image bento to expand */}
      {imageViewerUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setImageViewerUrl(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Image viewer"
        >
          <button
            type="button"
            onClick={() => setImageViewerUrl(null)}
            className="absolute top-4 right-4 rounded-full bg-white/10 p-2 text-zinc-300 hover:bg-white/20 hover:text-white transition-colors z-10"
            aria-label="Close viewer"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <img
            src={imageViewerUrl}
            alt="Expanded view"
            className="max-w-[90vw] max-h-[90vh] w-auto h-auto object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-zinc-400 hover:text-white text-sm">
            ← Home
          </Link>
          <Link href="/test-text" className="text-zinc-400 hover:text-white text-sm">
            /test-text
          </Link>
          <Link href="/test-url" className="text-zinc-400 hover:text-white text-sm">
            /test-url
          </Link>
          <h1 className="text-xl font-display tracking-wide">Analyze API — Test</h1>
        </div>

        <p className="text-sm text-zinc-500">
          Paste an image URL and a claim. The response from <code className="text-zinc-400">/api/analyze</code> is shown below.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="image-url" className="block text-sm text-zinc-500 mb-1">
              Image URL
            </label>
            <input
              id="image-url"
              type="url"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://..."
              className="w-full rounded bg-white/5 border border-white/10 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-white/20"
              required
            />
          </div>
          <div>
            <label htmlFor="user-claim" className="block text-sm text-zinc-500 mb-1">
              Claim
            </label>
            <input
              id="user-claim"
              type="text"
              value={userClaim}
              onChange={(e) => setUserClaim(e.target.value)}
              placeholder="e.g. Paris Riots 2026"
              className="w-full rounded bg-white/5 border border-white/10 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-white/20"
              required
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {loading ? "Calling API…" : "Analyze"}
          </button>
        </form>

        {error && (
          <div className="rounded border border-red-500/50 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Timeline — Always visible, shows placeholder when no data */}
        <div className="mt-8 rounded-xl border border-white/10 bg-white/[0.03] p-6">
          <span className="text-xs uppercase tracking-wider text-zinc-500 block mb-6 font-bold">
            Timeline — Image Story
          </span>
          <div ref={timelineContainerRef} className="relative flex flex-col pl-0 timeline-container">
            {/* Timeline lines are now drawn via CSS pseudo-elements on marker columns */}
            {/* Regular line is ::after on first marker column, bold line is ::before */}
            {rawResponse?.ok && rawResponse.body?.timeline && rawResponse.body.timeline.length > 0 ? (
              (() => {
                const nodes = rawResponse.body.timeline!;
                const explanation = rawResponse.body.explanation ?? "";
                const pageResults = rawResponse.body.aboutThisImage?.pageResults ?? [];
                const xLink = pageResults.find((p) => {
                  try {
                    const host = new URL(p.link).hostname.toLowerCase();
                    return host === "x.com" || host === "twitter.com";
                  } catch {
                    return false;
                  }
                });
                return nodes.map((node, i) => (
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
                        ref={i === 0 ? firstMarkerRef : null}
                        className="relative z-10 h-3 w-3 shrink-0 rounded-full border-2 border-zinc-500 bg-noir-bg timeline-marker"
                        aria-hidden
                      />
                    </div>
                    <div className="min-w-0 pl-2">
                      <p className="text-xs uppercase tracking-wider text-zinc-500 mb-0.5">
                        {node.label}
                      </p>
                      {i === 0 ? (
                        <>
                          <p className="text-sm font-medium text-zinc-300 mb-1">
                            Context
                          </p>
                          <p className="text-sm text-zinc-400 leading-relaxed mb-2">
                            {node.description || explanation || "Context not available from this source."}
                          </p>
                          <div className="text-xs text-zinc-500">
                            {xLink && (
                              <div className="mb-1">
                                <a
                                  href={xLink.link}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="hover:text-zinc-400 transition-colors block"
                                >
                                  Original post on X ↗
                                </a>
                              </div>
                            )}
                            <div className="mb-2">
                              <a
                                href={node.link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="hover:text-zinc-400 transition-colors block"
                              >
                                Source: {getDomain(node.link)}
                              </a>
                            </div>
                            <p className="text-xs text-zinc-500 mt-2 italic">
                              First appearance we found in our index. The image may have an earlier origin (e.g. original tweet or post).
                            </p>
                          </div>
                        </>
                      ) : (
                        <>
                          <p className="text-sm text-zinc-400 leading-relaxed mb-2">
                            {node.description}
                          </p>
                          <a
                            href={node.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-zinc-500 hover:text-zinc-400 transition-colors block"
                          >
                            Source: {getDomain(node.link)}
                          </a>
                        </>
                      )}
                    </div>
                  </div>
                ));
              })()
            ) : (
              /* Placeholder timeline */
              <>
                <div className="grid grid-cols-[5.5rem_24px_1fr] gap-4 items-start py-4 opacity-50">
                  <div className="rounded-md bg-white/95 px-2 py-1.5 text-center shrink-0 min-w-0">
                    <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-800 whitespace-nowrap block">
                      —
                    </span>
                  </div>
                  <div className="relative flex justify-center pt-1.5 shrink-0">
                    <div
                      ref={!rawResponse?.ok || !rawResponse.body?.timeline || rawResponse.body.timeline.length === 0 ? firstMarkerRef : null}
                      className="relative z-10 h-3 w-3 shrink-0 rounded-full border-2 border-zinc-500 bg-noir-bg timeline-marker"
                      aria-hidden
                    />
                  </div>
                  <div className="min-w-0 pl-2">
                    <p className="text-xs uppercase tracking-wider text-zinc-500 mb-0.5">
                      First Appearance
                    </p>
                    <p className="text-sm text-zinc-400 leading-relaxed">
                      Submit an investigation to see the timeline
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-[5.5rem_24px_1fr] gap-4 items-start py-4 opacity-50">
                  <div className="rounded-md bg-white/95 px-2 py-1.5 text-center shrink-0 min-w-0">
                    <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-800 whitespace-nowrap block">
                      —
                    </span>
                  </div>
                  <div className="relative flex justify-center pt-1.5 shrink-0">
                    <div
                      className="relative z-10 h-3 w-3 shrink-0 rounded-full border-2 border-zinc-500 bg-noir-bg timeline-marker"
                      aria-hidden
                    />
                  </div>
                  <div className="min-w-0 pl-2">
                    <p className="text-xs uppercase tracking-wider text-zinc-500 mb-0.5">
                      Current Version
                    </p>
                    <p className="text-sm text-zinc-400 leading-relaxed">
                      Timeline will appear here after analysis
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {rawResponse !== null && rawResponse.ok && rawResponse.body?.aboutThisImage && (
          <div className="space-y-4">
            <h2 className="text-sm font-medium text-zinc-400">Bento — About this image</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Age title: "Similar images are ..." in its own box */}
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 flex flex-col gap-2">
                <span className="text-xs uppercase tracking-wider text-zinc-500">Age / context</span>
                {rawResponse.body.aboutThisImage.headerTitle ? (
                  <p className="text-zinc-100 font-medium">
                    {rawResponse.body.aboutThisImage.headerTitle}
                  </p>
                ) : (
                  <p className="text-zinc-500 text-sm">No header title</p>
                )}
              </div>
              {/* Image bento: click to expand in viewer */}
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 flex flex-col gap-2">
                <span className="text-xs uppercase tracking-wider text-zinc-500">Image</span>
                {rawResponse.body.aboutThisImage.headerImage ? (
                  <button
                    type="button"
                    onClick={() => setImageViewerUrl(rawResponse.body!.aboutThisImage!.headerImage!)}
                    className="group relative rounded-lg w-full max-h-48 overflow-hidden border border-white/5 focus:outline-none focus:ring-2 focus:ring-white/20 text-left"
                  >
                    <img
                      src={rawResponse.body.aboutThisImage.headerImage}
                      alt="About this image"
                      className="w-full h-full object-cover cursor-pointer transition-transform duration-200 group-hover:scale-105"
                    />
                    <span
                      className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                      aria-hidden
                    >
                      <svg
                        className="w-10 h-10 text-white drop-shadow-md"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
                        />
                      </svg>
                    </span>
                  </button>
                ) : (
                  <p className="text-zinc-500 text-sm">No image</p>
                )}
              </div>
              {/* Verdict summary — full explanation, no ellipsis */}
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 flex flex-col gap-2 md:col-span-2">
                <span className="text-xs uppercase tracking-wider text-zinc-500">Verdict</span>
                <p className="text-zinc-100 font-medium">{rawResponse.body.verdict ?? "—"}</p>
                <p className="text-2xl font-display text-white">{rawResponse.body.score ?? 0}%</p>
                {rawResponse.body.explanation && (
                  <p className="text-sm text-zinc-400 whitespace-pre-wrap">{rawResponse.body.explanation}</p>
                )}
              </div>
            </div>
          </div>
        )}

        {rawResponse !== null && (
          <div>
            <h2 className="text-sm font-medium text-zinc-400 mb-2">Response (callback)</h2>
            <pre className="rounded border border-white/10 bg-black/40 p-4 text-xs text-zinc-300 overflow-x-auto whitespace-pre-wrap break-words">
              {JSON.stringify(rawResponse, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
