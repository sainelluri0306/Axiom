"use client";

import { useState, useRef, useEffect } from "react";
import PaperTrailsLogo from "@/components/PaperTrailsLogo";
import TextEncrypted from "@/components/TextEncrypted";
import skyline from "@/assets/skyline.jpg";
import magnifyingGlassGif from "@/assets/icons8-magnifying-glass.gif";

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
const HERO_PHRASE_PREFIX = "paste a"; // Erase only back to this between suggestions

function getDomain(link: string): string {
  try {
    return new URL(link).hostname.replace(/^www\./, "");
  } catch {
    return "Source";
  }
}

/** Only treat as image if URL has image extension OR is from a known image-only host. */
const IMAGE_EXT_REGEX = /\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?|$)/i;
const IMAGE_HOST_REGEX =
  /^https?:\/\/([^/]*\.)?(pbs\.twimg\.com|i\.imgur\.com|(?:farm\d+\.)?staticflickr\.com|(?:encrypted-)?tbn\d*\.gstatic\.com|([^/]*\.)?googleusercontent\.com)(\/|$|\?)/i;

function isImageUrlString(url: string): boolean {
  if (IMAGE_EXT_REGEX.test(url)) return true;
  if (IMAGE_HOST_REGEX.test(url)) return true;
  return false;
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
  const [enlargedImageUrl, setEnlargedImageUrl] = useState<string | null>(null);
  const heroFileInputRef = useRef<HTMLInputElement>(null);
  const heroTextareaRef = useRef<HTMLTextAreaElement>(null);
  const timelineContainerRef = useRef<HTMLDivElement>(null);
  const firstMarkerRef = useRef<HTMLDivElement>(null);
  const resultsSectionRef = useRef<HTMLElement>(null);
  const prevResultsLengthRef = useRef(0);

  const [animatedWord, setAnimatedWord] = useState(HERO_PHRASE_PREFIX);
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const phrase = HERO_PHRASES[phraseIndex];
    const typingSpeed = 70;
    const deletingSpeed = 40;
    const pauseAfterType = 1200;
    const pauseAfterDelete = 500;
    const prefixLen = HERO_PHRASE_PREFIX.length;
    const atPrefix = animatedWord === HERO_PHRASE_PREFIX || animatedWord.length <= prefixLen;
    let delay: number;
    if (isDeleting) {
      delay = animatedWord.length > prefixLen ? deletingSpeed : pauseAfterDelete;
    } else {
      delay =
        animatedWord.length === phrase.length
          ? pauseAfterType
          : atPrefix && animatedWord.length === prefixLen
            ? pauseAfterDelete
            : typingSpeed;
    }
    const timeout = window.setTimeout(() => {
      if (isDeleting) {
        if (animatedWord.length > prefixLen) {
          setAnimatedWord(animatedWord.slice(0, -1));
        } else {
          setIsDeleting(false);
          setPhraseIndex((i) => (i + 1) % HERO_PHRASES.length);
          setAnimatedWord(HERO_PHRASE_PREFIX);
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
    if (text && isImageUrlString(text)) {
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

  useEffect(() => {
    if (results.length > 0 && prevResultsLengthRef.current === 0) {
      resultsSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    prevResultsLengthRef.current = results.length;
  }, [results.length]);

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
    <div className="relative min-h-screen">
      {/* Skyline background: fit to viewport width, aligned to bottom; slides up on load */}
      <div
        className="skyline-slide-up fixed inset-0 z-0 bg-noir-bg bg-no-repeat bg-[length:100%_auto] bg-bottom"
        style={{ backgroundImage: `url(${skyline.src})` }}
        aria-hidden
      />
      <div className="fixed inset-0 z-[1] bg-black/55" aria-hidden />
      <div className="grain-overlay" aria-hidden="true" />
      <div className="relative z-10 flex min-h-screen flex-col">
        <main className="relative flex flex-1 flex-col items-center justify-center px-4 py-12 sm:px-6 sm:py-16 min-h-[85vh]">
          <div className="mx-auto flex w-full max-w-2xl flex-col items-center text-center">
            <header className="space-y-5">
              <h1 className="flex justify-center">
                <PaperTrailsLogo
                  className="h-20 w-auto sm:h-24 lg:h-28 text-white"
                  underlineDuration={0.7}
                />
              </h1>
              <p className="font-jost mx-auto max-w-2xl px-4 text-base tracking-wider text-zinc-500 sm:text-lg">
                <TextEncrypted
                  text="Don't just spot the fake. Prove the origin."
                  holdEncryptedMs={1000}
                  spreadMs={950}
                  className="text-inherit"
                />
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
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
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
              <div
                className="fixed inset-0 z-[20] flex flex-col items-center justify-center gap-6 bg-black/75 backdrop-blur-sm"
                aria-live="polite"
                aria-busy="true"
              >
                <img
                  src={magnifyingGlassGif.src ?? magnifyingGlassGif}
                  alt=""
                  className="h-16 w-16 sm:h-20 sm:w-20 invert"
                  aria-hidden
                />
                <p className="text-sm text-zinc-400">
                  {detectedScenarios.includes("image") && "Tracing image… "}
                  {detectedScenarios.includes("url") && "Scraping URL… "}
                  {detectedScenarios.includes("text") && "Fact-checking…"}
                </p>
              </div>
            )}

            {error && (
              <p className="mt-4 text-sm text-red-400" role="alert">
                {error}
              </p>
            )}
          </div>

          {/* Image viewer overlay: click output image to enlarge */}
          {enlargedImageUrl && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
              onClick={() => setEnlargedImageUrl(null)}
              role="dialog"
              aria-modal="true"
              aria-label="Image viewer"
            >
              <button
                type="button"
                onClick={() => setEnlargedImageUrl(null)}
                className="absolute top-4 right-4 rounded-full bg-white/10 p-2 text-zinc-300 hover:bg-white/20 hover:text-white transition-colors z-10"
                aria-label="Close viewer"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              <img
                src={enlargedImageUrl}
                alt="Expanded view"
                className="max-w-[90vw] max-h-[90vh] w-auto h-auto object-contain rounded-lg shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )}

          {results.length > 0 && (
            <section
              ref={resultsSectionRef}
              className="mt-10 w-full px-4 sm:px-6 lg:px-8 text-left scroll-mt-20"
              aria-label="Results"
            >
                {results.map((result, resultIdx) => {
                  const stats = renderVerdictStats(result);
                  const pageResults =
                    result.pageResults ?? result.aboutThisImage?.pageResults ?? [];
                  const factCheckSources = pageResults.filter((p) => {
                    const s = (p.source ?? "").toLowerCase();
                    const link = (p.link ?? "").toLowerCase();
                    return (
                      s.includes("politifact") ||
                      s.includes("snopes") ||
                      link.includes("politifact") ||
                      link.includes("snopes")
                    );
                  });
                  const otherSources = pageResults.filter((p) => {
                    const s = (p.source ?? "").toLowerCase();
                    const link = (p.link ?? "").toLowerCase();
                    return (
                      !s.includes("politifact") &&
                      !s.includes("snopes") &&
                      !link.includes("politifact") &&
                      !link.includes("snopes")
                    );
                  });

                  return (
                    <div
                      key={resultIdx}
                      className="results-dashboard grid grid-cols-1 lg:grid-cols-3 gap-6 items-start"
                    >
                      {/* Left 1/3: Timeline */}
                      <div className="rounded-xl border border-white/10 bg-white/[0.03] backdrop-blur-xl p-6">
                        <span className="text-xs uppercase tracking-wider text-zinc-500 block mb-4 font-bold">
                          Timeline — findings
                        </span>
                        <div
                          ref={resultIdx === 0 ? timelineContainerRef : null}
                          className="relative flex flex-col pl-0 timeline-container"
                        >
                          {result.timeline && result.timeline.length > 0 ? (
                            result.timeline.map((node, i) => {
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
                                    {node.link && (
                                      <div className="text-xs text-zinc-500 space-y-1">
                                        <a
                                          href={node.link}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="hover:text-zinc-400 block"
                                        >
                                          Source: {getDomain(node.link)}
                                        </a>
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

                      {/* Middle 1/3: Verdict (no %) + Sources */}
                      <div className="flex min-w-0 flex-col gap-6">
                        <div className="rounded-xl border border-white/10 bg-white/[0.03] backdrop-blur-xl p-6">
                          <p className="text-lg font-medium text-white mb-2">
                            {result.verdict}
                          </p>
                          {stats.isUnverifiable ? (
                            <p className="text-sm text-amber-400/90 font-medium">
                              Not enough information to verify
                            </p>
                          ) : null}
                          {result.explanation && (
                            <p className="text-sm text-zinc-400 whitespace-pre-wrap">
                              {result.explanation}
                            </p>
                          )}
                        </div>
                        <div className="relevant-sources w-full min-w-0 overflow-hidden rounded-xl border border-white/10 bg-white/[0.03] backdrop-blur-xl p-6">
                          <span className="text-xs uppercase tracking-wider text-zinc-500 block mb-3">
                            Relevant sources
                          </span>
                          {otherSources.length > 0 ? (
                            <ul className="min-w-0 w-full space-y-2 overflow-hidden">
                              {otherSources.slice(0, 10).map((p, i) => {
                                const domain = getDomain(p.link);
                                return (
                                  <li key={i} className="min-w-0 w-full overflow-hidden">
                                    <a
                                      href={p.link}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="flex w-full min-w-0 items-center gap-3 overflow-hidden rounded-full bg-white/[0.06] px-4 py-2.5 text-left transition-colors hover:bg-white/[0.1]"
                                    >
                                      <img
                                        src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`}
                                        alt=""
                                        className="h-5 w-5 shrink-0 rounded-full object-cover"
                                        aria-hidden
                                      />
                                      <span className="shrink-0 text-xs text-zinc-400">
                                        {domain}
                                      </span>
                                      <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-sm text-zinc-200" title={p.title || undefined}>
                                        {p.title || "Untitled"}
                                      </span>
                                    </a>
                                  </li>
                                );
                              })}
                            </ul>
                          ) : (
                            <p className="text-sm text-zinc-500">No sources returned.</p>
                          )}
                        </div>
                      </div>

                      {/* Right 1/3: Score | About this image | Fact-check sites */}
                      <div className="flex flex-col gap-6">
                        <div className="rounded-xl border border-white/10 bg-white/[0.03] backdrop-blur-xl p-6">
                          <span className="text-xs uppercase tracking-wider text-zinc-500 block mb-2">
                            Score
                          </span>
                          {stats.isUnverifiable ? (
                            <p className="text-2xl font-display text-zinc-500">—</p>
                          ) : (
                            <>
                              <p className="text-3xl font-display text-white">{stats.displayPct}%</p>
                              <p className="text-xs text-zinc-500 mt-1">{stats.scoreLabel}</p>
                            </>
                          )}
                        </div>

                        {result.aboutThisImage && (result.aboutThisImage.headerImage || result.aboutThisImage.headerTitle) && (
                          <div className="rounded-xl border border-white/10 bg-white/[0.03] backdrop-blur-xl p-6">
                            <span className="text-xs uppercase tracking-wider text-zinc-500 block mb-3">
                              About this image
                            </span>
                            {result.aboutThisImage.headerTitle && (
                              <p className="text-zinc-100 font-medium mb-2">
                                {result.aboutThisImage.headerTitle}
                              </p>
                            )}
                            {result.aboutThisImage.headerImage && (
                              <button
                                type="button"
                                onClick={() => setEnlargedImageUrl(result.aboutThisImage!.headerImage!)}
                                className="group relative rounded-lg w-full max-h-40 overflow-hidden border-0 p-0 focus:outline-none focus:ring-2 focus:ring-white/20 text-left"
                              >
                                <img
                                  src={result.aboutThisImage.headerImage}
                                  alt="Analyzed — click to enlarge"
                                  className="rounded-lg w-full max-h-40 object-cover cursor-pointer transition-transform duration-200 group-hover:scale-[1.02]"
                                />
                                <span
                                  className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                                  aria-hidden
                                >
                                  <svg
                                    className="w-10 h-10 text-white drop-shadow-md"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                  >
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                                  </svg>
                                </span>
                              </button>
                            )}
                          </div>
                        )}

                        <div className="rounded-xl border border-white/10 bg-white/[0.03] backdrop-blur-xl p-6">
                          <span className="text-xs uppercase tracking-wider text-zinc-500 block mb-3">
                            Fact-check sites
                          </span>
                          {factCheckSources.length > 0 ? (
                            <ul className="space-y-2">
                              {factCheckSources.map((p, i) => (
                                <li key={i} className="text-sm">
                                  <a
                                    href={p.link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-zinc-300 hover:text-white transition-colors"
                                  >
                                    {p.title}
                                  </a>
                                  {p.source && (
                                    <span className="text-zinc-500 text-xs block mt-0.5">{p.source}</span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-sm text-zinc-500">
                              No PolitiFact or Snopes results in this response.
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
