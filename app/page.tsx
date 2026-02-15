"use client";

import { useState, useRef, useEffect } from "react";
import Nav from "@/components/Nav";

type TimelineNode = {
  label: string;
  date: string;
  description: string;
  link: string;
};

type PageResultItem = {
  date: string;
  link: string;
  title: string;
  snippet: string | null;
  source?: string;
};

type UnifiedResult = {
  scenario: "image" | "text" | "url";
  verdict: string;
  score: number;
  explanation: string;
  timeline?: TimelineNode[];
  pageResults?: PageResultItem[];
  scrapedContent?: { title: string; description: string; body: string };
  aboutThisImage?: {
    headerTitle: string | null;
    headerImage: string | null;
    pageResults: PageResultItem[];
  };
};

const HERO_PHRASES = [
  "paste a claim",
  "paste an image URL",
  "paste an article URL",
  "paste a tweet link",
  "paste a fact to verify",
];

function getDomain(link: string): string {
  try {
    return new URL(link).hostname.replace(/^www\./, "");
  } catch {
    return "Source";
  }
}

const IMAGE_URL_REGEX =
  /\.(jpg|jpeg|png|gif|webp)(\?|$)/i;
const IMAGE_DOMAIN_REGEX =
  /pbs\.twimg\.com|imgur\.com|i\.imgur\.com|cdn\.|\.staticflickr\./i;

function isImageUrlString(url: string): boolean {
  return IMAGE_URL_REGEX.test(url) || IMAGE_DOMAIN_REGEX.test(url);
}

/** Parse input into image URLs, page URLs, and claim text. */
function parseInput(
  text: string,
  hasImagePreview: boolean,
  imageSourceUrl: string | null
): {
  imageUrls: string[];
  pageUrls: string[];
  claimText: string;
} {
  const imageUrls: string[] = [];
  const pageUrls: string[] = [];
  let working = text.trim();

  if (hasImagePreview && imageSourceUrl && !imageSourceUrl.startsWith("blob:")) {
    imageUrls.push(imageSourceUrl);
  }

  const urlRegex = /https?:\/\/[^\s]+/g;
  let match: RegExpExecArray | null;
  const urlSpans: { url: string; start: number; end: number }[] = [];
  while ((match = urlRegex.exec(working)) !== null) {
    const url = match[0].replace(/[.,;:!?)]+$/, "");
    if (isImageUrlString(url)) {
      if (!imageUrls.includes(url)) imageUrls.push(url);
    } else {
      pageUrls.push(url);
    }
    urlSpans.push({ url: match[0], start: match.index, end: match.index + match[0].length });
  }

  const claimParts: string[] = [];
  let lastEnd = 0;
  for (const span of urlSpans.sort((a, b) => a.start - b.start)) {
    const between = working.slice(lastEnd, span.start).trim();
    if (between.length > 0) claimParts.push(between);
    lastEnd = span.end;
  }
  const after = working.slice(lastEnd).trim();
  if (after.length > 0) claimParts.push(after);
  const claimText = claimParts.join(" ").trim();

  return { imageUrls, pageUrls, claimText };
}

export default function Home() {
  const [heroText, setHeroText] = useState("");
  const [heroImagePreview, setHeroImagePreview] = useState<string | null>(null);
  const [heroImageSourceUrl, setHeroImageSourceUrl] = useState<string | null>(null);
  const [heroInputFocused, setHeroInputFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<UnifiedResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [detectedScenarios, setDetectedScenarios] = useState<Array<"image" | "url" | "text">>([]);
  const heroFileInputRef = useRef<HTMLInputElement>(null);
  const heroTextareaRef = useRef<HTMLTextAreaElement>(null);
  const timelineContainerRef = useRef<HTMLDivElement>(null);
  const firstMarkerRef = useRef<HTMLDivElement>(null);

  const [animatedWord, setAnimatedWord] = useState("");
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const phrase = HERO_PHRASES[phraseIndex];
    const typingSpeed = 70;
    const deletingSpeed = 40;
    const pauseAfterType = 1200;
    const pauseAfterDelete = 500;
    let delay: number;
    if (isDeleting) {
      delay = animatedWord.length > 0 ? deletingSpeed : pauseAfterDelete;
    } else {
      delay =
        animatedWord.length === phrase.length
          ? pauseAfterType
          : animatedWord.length === 0
            ? pauseAfterDelete
            : typingSpeed;
    }
    const timeout = window.setTimeout(() => {
      if (isDeleting) {
        if (animatedWord.length > 0) setAnimatedWord(animatedWord.slice(0, -1));
        else {
          setIsDeleting(false);
          setPhraseIndex((i) => (i + 1) % HERO_PHRASES.length);
        }
      } else {
        if (animatedWord.length < phrase.length)
          setAnimatedWord(phrase.slice(0, animatedWord.length + 1));
        else setIsDeleting(true);
      }
    }, delay);
    return () => window.clearTimeout(timeout);
  }, [phraseIndex, isDeleting, animatedWord]);

  useEffect(() => {
    const ta = heroTextareaRef.current;
    if (!ta) return;
    if (!heroText.trim()) {
      ta.style.height = "";
      ta.style.overflowY = "";
      return;
    }
    ta.style.height = "auto";
    const lineHeight = 24;
    const maxH = lineHeight * 6;
    const h = Math.min(maxH, Math.max(lineHeight, ta.scrollHeight));
    ta.style.height = `${h}px`;
    ta.style.overflowY = ta.scrollHeight > maxH ? "scroll" : "hidden";
  }, [heroText]);

  useEffect(() => {
    const updateLinePosition = () => {
      if (firstMarkerRef.current && timelineContainerRef.current) {
        const markerRect = firstMarkerRef.current.getBoundingClientRect();
        const containerRect = timelineContainerRef.current.getBoundingClientRect();
        const lineLeft = markerRect.left - containerRect.left + markerRect.width / 2;
        timelineContainerRef.current.style.setProperty("--timeline-line-left", `${lineLeft}px`);
      }
    };
    const t = setTimeout(() => requestAnimationFrame(updateLinePosition), 100);
    window.addEventListener("resize", updateLinePosition);
    const obs =
      timelineContainerRef.current ?
        new MutationObserver(() => requestAnimationFrame(updateLinePosition))
      : null;
    if (timelineContainerRef.current && obs) {
      obs.observe(timelineContainerRef.current, { childList: true, subtree: true });
    }
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", updateLinePosition);
      obs?.disconnect();
    };
  }, [results]);

  function isImageUrl(s: string): boolean {
    return /^https?:\/\/\S+$/i.test(s.trim()) && s.length < 2048;
  }

  function handleHeroPaste(e: React.ClipboardEvent) {
    const dt = e.clipboardData;
    if (!dt) return;
    if (dt.files?.length) {
      const file = dt.files[0];
      if (!file.type.startsWith("image/")) return;
      e.preventDefault();
      if (heroImagePreview?.startsWith("blob:")) URL.revokeObjectURL(heroImagePreview);
      setHeroImagePreview(URL.createObjectURL(file));
      setHeroImageSourceUrl(null);
      return;
    }
    const text = dt.getData("text/plain")?.trim();
    if (text && isImageUrl(text)) {
      e.preventDefault();
      if (heroImagePreview?.startsWith("blob:")) URL.revokeObjectURL(heroImagePreview);
      setHeroImagePreview(text);
      setHeroImageSourceUrl(text);
    }
  }

  function removeHeroImage() {
    if (heroImagePreview?.startsWith("blob:")) URL.revokeObjectURL(heroImagePreview);
    setHeroImagePreview(null);
    setHeroImageSourceUrl(null);
    heroFileInputRef.current && (heroFileInputRef.current.value = "");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResults([]);

    const { imageUrls, pageUrls, claimText } = parseInput(
      heroText,
      !!heroImagePreview,
      heroImageSourceUrl
    );

    const hasImage = imageUrls.length > 0 || (heroImagePreview && heroImageSourceUrl);
    const hasPageUrl = pageUrls.length > 0;
    const hasClaim = claimText.length >= 3;

    if (!hasImage && !hasPageUrl && !hasClaim) {
      setError("Enter a claim, image URL, or article link to analyze.");
      return;
    }

    const toRun: Array<"image" | "url" | "text"> = [];
    if (hasImage) toRun.push("image");
    if (hasPageUrl) toRun.push("url");
    if (hasClaim && !hasImage && !hasPageUrl) toRun.push("text");
    setDetectedScenarios(toRun);
    setLoading(true);

    const allResults: UnifiedResult[] = [];
    let firstError: string | null = null;

    try {
      const imageUrl = imageUrls[0] ?? (heroImagePreview && heroImageSourceUrl && !heroImageSourceUrl.startsWith("blob:") ? heroImageSourceUrl : null);
      const pageUrl = pageUrls[0] ?? null;
      const claim = claimText || "Verify the context and origin of this image.";

      const promises: Promise<void>[] = [];

      if (toRun.includes("image") && imageUrl && !imageUrl.startsWith("blob:")) {
        promises.push(
          fetch("/api/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              imageUrl,
              userClaim: claim || (pageUrl ? `See also: ${pageUrl}` : "Verify the context and origin of this image."),
            }),
          })
            .then(async (res) => {
              const data = await res.json();
              if (!res.ok) throw new Error(data.error ?? "Image analysis failed");
              allResults.push({
                scenario: "image",
                verdict: data.verdict ?? "—",
                score: data.score ?? 0,
                explanation: data.explanation ?? "",
                timeline: data.timeline,
                pageResults: data.aboutThisImage?.pageResults,
                aboutThisImage: data.aboutThisImage,
              });
            })
            .catch((err) => {
              if (!firstError) firstError = err instanceof Error ? err.message : "Image analysis failed";
            })
        );
      }

      if (toRun.includes("url") && pageUrl) {
        promises.push(
          fetch("/api/analyze-url", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              url: pageUrl,
              claim: hasClaim ? claimText : undefined,
            }),
          })
            .then(async (res) => {
              const data = await res.json();
              if (!res.ok) throw new Error(data.error ?? "URL analysis failed");
              allResults.push({
                scenario: "url",
                verdict: data.verdict ?? "—",
                score: data.score ?? 0,
                explanation: data.explanation ?? "",
                timeline: data.timeline,
                pageResults: data.pageResults,
                scrapedContent: data.scrapedContent,
              });
            })
            .catch((err) => {
              if (!firstError) firstError = err instanceof Error ? err.message : "URL analysis failed";
            })
        );
      }

      if (toRun.includes("text") && hasClaim) {
        promises.push(
          fetch("/api/analyze-text", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ claim: claimText }),
          })
            .then(async (res) => {
              const data = await res.json();
              if (!res.ok) throw new Error(data.error ?? "Text analysis failed");
              allResults.push({
                scenario: "text",
                verdict: data.verdict ?? "—",
                score: data.score ?? 0,
                explanation: data.explanation ?? "",
                timeline: data.timeline,
                pageResults: data.pageResults,
              });
            })
            .catch((err) => {
              if (!firstError) firstError = err instanceof Error ? err.message : "Text analysis failed";
            })
        );
      }

      await Promise.all(promises);
      setResults(allResults);
      if (allResults.length === 0 && firstError) setError(firstError);
      else if (
        allResults.length === 0 &&
        toRun.includes("image") &&
        (heroImagePreview?.startsWith("blob:") || (heroImagePreview && !imageUrl))
      ) {
        setError("For image analysis, paste an image URL (right-click → Copy image address). File upload requires a public URL.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  function renderVerdictStats(r: UnifiedResult) {
    const verdict = r.verdict ?? "";
    const score = r.score ?? 0;
    const isTrueVerdict =
      verdict.toUpperCase().includes("TRUE") && !verdict.toUpperCase().includes("FALSE");
    const isUnverifiable =
      verdict.toUpperCase().includes("UNVERIFIED") ||
      verdict.toUpperCase().includes("MIXED") ||
      verdict.toUpperCase().includes("NO EVIDENCE") ||
      verdict.toUpperCase().includes("INSUFFICIENT") ||
      verdict.toUpperCase().includes("INVALID");
    const displayPct = isTrueVerdict ? 100 - score : score;
    const scoreLabel = isTrueVerdict ? "Accuracy" : "False / misleading";
    return { isUnverifiable, displayPct, scoreLabel };
  }

  return (
    <div className="noir-bg-base min-h-screen">
      <div className="grain-overlay" aria-hidden="true" />
      <div className="relative z-10 flex min-h-screen flex-col">
        <Nav />

        <main className="relative flex flex-1 flex-col items-center px-4 py-12 sm:px-6 sm:py-16">
          <div className="mx-auto flex w-full max-w-2xl flex-col items-center text-center">
            <header className="space-y-5">
              <h1 className="font-display text-4xl font-normal leading-[1.15] tracking-tight text-white sm:text-5xl lg:text-[3.25rem]">
                Your provenance engine
                <br />
                for the internet.
              </h1>
              <p className="mx-auto max-w-md text-sm tracking-wide text-zinc-500 sm:text-base">
                Paste any combination: claim, image URL, article link. We&apos;ll run all that apply.
              </p>
            </header>

            <form onSubmit={handleSubmit} className="chat-input-box mt-10 w-full max-w-2xl">
              <input
                ref={heroFileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                aria-hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  if (heroImagePreview?.startsWith("blob:"))
                    URL.revokeObjectURL(heroImagePreview);
                  setHeroImagePreview(URL.createObjectURL(f));
                  setHeroImageSourceUrl(null);
                }}
              />
              <div className="flex flex-col gap-3 p-3" onPaste={handleHeroPaste}>
                {heroImagePreview && (
                  <div className="group relative w-fit">
                    <img
                      src={heroImagePreview}
                      alt="Preview"
                      className="h-24 w-auto rounded-lg object-cover sm:h-28"
                    />
                    <div className="absolute right-1 top-1 flex gap-1">
                      <button
                        type="button"
                        onClick={() => heroFileInputRef.current?.click()}
                        className="flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-zinc-800 hover:bg-white"
                        aria-label="Replace image"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={removeHeroImage}
                        className="flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-zinc-800 hover:bg-white"
                        aria-label="Remove image"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                )}
                <div className="relative w-full">
                  {!heroText && !heroImagePreview && !heroInputFocused && (
                    <div className="pointer-events-none absolute inset-0 flex items-center px-0 py-3 text-sm text-zinc-500">
                      <span className="whitespace-pre">
                        {animatedWord}
                        <span className="hero-cursor" />
                      </span>
                    </div>
                  )}
                  <textarea
                    ref={heroTextareaRef}
                    value={heroText}
                    onChange={(e) => setHeroText(e.target.value)}
                    onFocus={() => setHeroInputFocused(true)}
                    onBlur={() => setHeroInputFocused(false)}
                    onPaste={handleHeroPaste}
                    placeholder=""
                    rows={1}
                    className="hero-input hero-textarea w-full resize-none bg-transparent px-0 py-3 text-sm text-white placeholder-zinc-500 focus:outline-none"
                    disabled={loading}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between border-t border-white/[0.06] px-3 py-2">
                <button
                  type="button"
                  onClick={() => heroFileInputRef.current?.click()}
                  className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-300 hover:bg-white/10 hover:text-zinc-100"
                  aria-label="Upload image"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14" />
                  </svg>
                  Image
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-zinc-900 hover:bg-zinc-200 disabled:opacity-50"
                  aria-label="Investigate"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                  </svg>
                </button>
              </div>
            </form>

            {loading && (
              <p className="mt-4 text-sm text-zinc-500">
                {detectedScenarios.includes("image") && "Tracing image… "}
                {detectedScenarios.includes("url") && "Scraping URL… "}
                {detectedScenarios.includes("text") && "Fact-checking…"}
              </p>
            )}

            {error && (
              <p className="mt-4 text-sm text-red-400" role="alert">
                {error}
              </p>
            )}

            {results.length > 0 && (
              <section className="mt-10 w-full max-w-2xl text-left space-y-10">
                {results.map((result, resultIdx) => {
                  const stats = renderVerdictStats(result);
                  const pageResults =
                    result.pageResults ?? result.aboutThisImage?.pageResults ?? [];
                  return (
                    <div key={resultIdx} className="space-y-6">
                      <span className="text-xs uppercase tracking-wider text-zinc-500">
                        {result.scenario === "image" && "Image analysis"}
                        {result.scenario === "url" && "URL / article analysis"}
                        {result.scenario === "text" && "Text fact-check"}
                      </span>

                      {result.scrapedContent &&
                        (result.scrapedContent.title || result.scrapedContent.description) && (
                          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                            <span className="text-xs uppercase tracking-wider text-zinc-500 block mb-2">
                              From URL
                            </span>
                            {result.scrapedContent.title && (
                              <p className="text-zinc-100 font-medium mb-1">
                                {result.scrapedContent.title}
                              </p>
                            )}
                            {result.scrapedContent.description && (
                              <p className="text-sm text-zinc-400 line-clamp-3">
                                {result.scrapedContent.description}
                              </p>
                            )}
                          </div>
                        )}

                      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 flex flex-col gap-2">
                        <span className="text-xs uppercase tracking-wider text-zinc-500">Verdict</span>
                        <p className="text-zinc-100 font-medium">{result.verdict}</p>
                        {stats.isUnverifiable ? (
                          <p className="text-sm text-amber-400/90 font-medium">
                            Not enough information to verify
                          </p>
                        ) : (
                          <>
                            <p className="text-2xl font-display text-white">{stats.displayPct}%</p>
                            <p className="text-xs text-zinc-500">{stats.scoreLabel}</p>
                          </>
                        )}
                        {result.explanation && (
                          <p className="text-sm text-zinc-400 whitespace-pre-wrap mt-2">
                            {result.explanation}
                          </p>
                        )}
                      </div>

                      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-6">
                        <span className="text-xs uppercase tracking-wider text-zinc-500 block mb-6 font-bold">
                          Timeline — findings
                        </span>
                        <div
                          ref={resultIdx === 0 ? timelineContainerRef : null}
                          className="relative flex flex-col pl-0 timeline-container"
                        >
                          {result.timeline && result.timeline.length > 0 ? (
                            result.timeline.map((node, i) => {
                              const xLink = pageResults.find((p) => {
                                try {
                                  const h = new URL(p.link).hostname.toLowerCase();
                                  return h === "x.com" || h === "twitter.com";
                                } catch {
                                  return false;
                                }
                              });
                              return (
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
                                      ref={resultIdx === 0 && i === 0 ? firstMarkerRef : null}
                                      className="relative z-10 h-3 w-3 shrink-0 rounded-full border-2 border-zinc-500 bg-noir-bg timeline-marker"
                                      aria-hidden
                                    />
                                  </div>
                                  <div className="min-w-0 pl-2">
                                    <p className="text-xs uppercase tracking-wider text-zinc-500 mb-0.5">
                                      {node.label}
                                    </p>
                                    <p className="text-sm text-zinc-400 leading-relaxed mb-2">
                                      {node.description || result.explanation || "—"}
                                    </p>
                                    {(xLink || node.link) && (
                                      <div className="text-xs text-zinc-500 space-y-1">
                                        {xLink && (
                                          <a
                                            href={xLink.link}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="hover:text-zinc-400 block"
                                          >
                                            Original post on X ↗
                                          </a>
                                        )}
                                        {node.link && (
                                          <a
                                            href={node.link}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="hover:text-zinc-400 block"
                                          >
                                            Source: {getDomain(node.link)}
                                          </a>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })
                          ) : (
                            <div className="grid grid-cols-[5.5rem_24px_1fr] gap-4 items-start py-4 opacity-50">
                              <div className="rounded-md bg-white/95 px-2 py-1.5 text-center shrink-0 min-w-0">
                                <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-800">—</span>
                              </div>
                              <div className="relative flex justify-center pt-1.5 shrink-0">
                                <div
                                  ref={resultIdx === 0 ? firstMarkerRef : null}
                                  className="relative z-10 h-3 w-3 shrink-0 rounded-full border-2 border-zinc-500 bg-noir-bg timeline-marker"
                                  aria-hidden
                                />
                              </div>
                              <div className="min-w-0 pl-2">
                                <p className="text-xs uppercase tracking-wider text-zinc-500">No timeline</p>
                                <p className="text-sm text-zinc-400">No timeline data returned.</p>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {result.aboutThisImage?.headerImage && (
                        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                          <span className="text-xs uppercase tracking-wider text-zinc-500 block mb-2">
                            About this image
                          </span>
                          {result.aboutThisImage.headerTitle && (
                            <p className="text-zinc-100 font-medium mb-2">
                              {result.aboutThisImage.headerTitle}
                            </p>
                          )}
                          <img
                            src={result.aboutThisImage.headerImage}
                            alt="Analyzed"
                            className="rounded-lg max-h-48 object-cover"
                          />
                        </div>
                      )}

                      {result.pageResults && result.pageResults.length > 0 && (
                        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                          <span className="text-xs uppercase tracking-wider text-zinc-500 block mb-3">
                            Sources (Web, News, PolitiFact, Snopes)
                          </span>
                          <ul className="space-y-2">
                            {result.pageResults.slice(0, 12).map((p, i) => (
                              <li key={i} className="text-sm">
                                {p.source && (
                                  <span className="text-zinc-500 text-xs uppercase mr-2">
                                    [{p.source}]
                                  </span>
                                )}
                                <a
                                  href={p.link}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-zinc-300 hover:text-white transition-colors"
                                >
                                  {p.title}
                                </a>
                                {p.snippet && (
                                  <p className="text-zinc-500 text-xs mt-0.5 line-clamp-2">{p.snippet}</p>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  );
                })}
              </section>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
