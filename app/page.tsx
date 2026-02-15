"use client";

import React, { useState, useRef, useEffect } from "react";
import PaperTrailsLogo from "@/components/PaperTrailsLogo";
import TextEncrypted from "@/components/TextEncrypted";
import skyline from "@/assets/skyline.jpg";
import magnifyingGlassGif from "@/assets/icons8-magnifying-glass.gif";
import trueSvg from "@/assets/true.svg";
import falseSvg from "@/assets/false.svg";

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

/** Format timeline date to always include year (e.g. "Jan 15, 2024"). */
function formatTimelineDate(dateStr: string): string {
  const trimmed = dateStr.trim();
  if (!trimmed) return trimmed;
  const hasYear = /\b(19|20)\d{2}\b/.test(trimmed);
  const d = new Date(trimmed);
  if (!Number.isNaN(d.getTime())) {
    const mon = d.toLocaleString("en-US", { month: "short" });
    const day = d.getDate();
    const year = d.getFullYear();
    return `${mon} ${day}, ${year}`;
  }
  if (!hasYear) {
    const year = new Date().getFullYear();
    return `${trimmed}, ${year}`;
  }
  return trimmed;
}

/** Render explanation with **bold** and [text](url) as formatted content. */
function renderFormattedExplanation(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let key = 0;
  let i = 0;
  while (i < text.length) {
    if (text.slice(i, i + 2) === "**") {
      const end = text.indexOf("**", i + 2);
      if (end !== -1) {
        const boldContent = text.slice(i + 2, end);
        parts.push(
          <strong key={key++} className="font-semibold text-zinc-300">
            {renderFormattedExplanation(boldContent)}
          </strong>
        );
        i = end + 2;
        continue;
      }
    }
    if (text[i] === "[") {
      const closeBracket = text.indexOf("]", i + 1);
      if (closeBracket !== -1 && text[closeBracket + 1] === "(") {
        const closeParen = text.indexOf(")", closeBracket + 2);
        if (closeParen !== -1) {
          const linkText = text.slice(i + 1, closeBracket);
          const linkUrl = text.slice(closeBracket + 2, closeParen);
          parts.push(
            <a
              key={key++}
              href={linkUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-zinc-300 underline hover:text-white"
            >
              {linkText}
            </a>
          );
          i = closeParen + 1;
          continue;
        }
      }
    }
    const nextBold = text.indexOf("**", i);
    const nextLink = text.indexOf("[", i);
    let end = text.length;
    if (nextBold !== -1) end = Math.min(end, nextBold);
    if (nextLink !== -1) end = Math.min(end, nextLink);
    parts.push(text.slice(i, end));
    i = end;
  }
  return parts.length === 1 ? parts[0] : parts;
}

/** Convert a blob URL (paste/upload) to base64 + contentType for the analyze API. */
async function blobUrlToBase64(blobUrl: string): Promise<{ base64: string; contentType: string }> {
  const res = await fetch(blobUrl);
  const blob = await res.blob();
  const contentType = blob.type || "image/jpeg";
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const dataUrl = fr.result as string;
      const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
      if (m) resolve({ contentType: m[1], base64: m[2] });
      else reject(new Error("Could not read image data"));
    };
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
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

    const hasImage = imageUrls.length > 0 || !!heroImagePreview;
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
      const publicImageUrl = imageUrls[0] ?? (heroImagePreview && heroImageSourceUrl && !heroImageSourceUrl.startsWith("blob:") ? heroImageSourceUrl : null);
      const hasPastedOrUploadedImage = toRun.includes("image") && heroImagePreview?.startsWith("blob:");
      const pageUrl = pageUrls[0] ?? null;
      const claim = claimText || "Verify the context and origin of this image.";

      const promises: Promise<void>[] = [];

      if (toRun.includes("image") && (publicImageUrl || hasPastedOrUploadedImage)) {
        const analyzePayload = async (): Promise<{ imageUrl?: string; imageData?: string; contentType?: string }> => {
          if (publicImageUrl && !publicImageUrl.startsWith("blob:")) {
            return { imageUrl: publicImageUrl };
          }
          if (heroImagePreview?.startsWith("blob:")) {
            const { base64, contentType } = await blobUrlToBase64(heroImagePreview);
            return { imageData: base64, contentType };
          }
          return {};
        };
        promises.push(
          analyzePayload()
            .then((payload) => {
              if (!payload.imageUrl && !payload.imageData) return;
              return fetch("/api/analyze", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  ...payload,
                  userClaim: claim || (pageUrl ? `See also: ${pageUrl}` : "Verify the context and origin of this image."),
                }),
              });
            })
            .then(async (res) => {
              if (!res) return;
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
    const scoreInterpretation = isTrueVerdict ? "accurate" : "false / misleading";
    return { isTrueVerdict, isUnverifiable, displayPct, scoreInterpretation };
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
              <p
                className="font-jost mx-auto max-w-2xl px-4 text-base tracking-wider text-zinc-400 sm:text-lg"
                style={{
                  textShadow: "0 3px 6px black, 0 6px 12px black, 0 8px 24px rgba(0,0,0,0.9), 0 0 10px rgba(0,0,0,0.9), 0 0 20px rgba(0,0,0,0.7), 0 0 40px rgba(0,0,0,0.5), 0 2px 4px rgba(0,0,0,0.9)",
                }}
              >
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
                      s.includes("afp") ||
                      link.includes("politifact") ||
                      link.includes("snopes") ||
                      link.includes("factcheck.afp")
                    );
                  });
                  const otherSources = pageResults.filter((p) => {
                    const s = (p.source ?? "").toLowerCase();
                    const link = (p.link ?? "").toLowerCase();
                    return (
                      !s.includes("politifact") &&
                      !s.includes("snopes") &&
                      !s.includes("afp") &&
                      !link.includes("politifact") &&
                      !link.includes("snopes") &&
                      !link.includes("factcheck.afp")
                    );
                  });

                  return (
                    <div
                      key={resultIdx}
                      className="results-dashboard grid grid-cols-1 lg:grid-cols-3 gap-6 items-start"
                    >
                      {/* Left 1/3: Timeline */}
                      <div
                        className={`rounded-xl border border-white/10 bg-white/[0.03] backdrop-blur-xl p-6 ${stats.isTrueVerdict ? "timeline-verdict-true" : stats.isUnverifiable ? "" : "timeline-verdict-false"}`}
                      >
                        <span className="text-xs uppercase tracking-wider text-zinc-500 block mb-4 font-bold">
                          Timeline
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
                                      {formatTimelineDate(node.date)}
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

                      {/* Middle 1/3: Verdict (stamp) + Sources */}
                      <div className="flex min-w-0 flex-col gap-6">
                        <div className="relative rounded-xl border border-white/10 bg-white/[0.03] backdrop-blur-xl p-6">
                          <div className="flex justify-center mb-5">
                            {stats.isUnverifiable ? (
                              <span
                                className="inline-block px-5 py-2.5 text-xl font-bold uppercase tracking-[0.2em] border-2 border-dashed border-amber-500/80 text-amber-400/90 -rotate-1"
                                style={{
                                  fontFamily: "var(--font-display), 'Special Elite', monospace",
                                  boxShadow: "inset 0 0 0 1px rgba(245, 158, 11, 0.15), 0 0 8px rgba(245, 158, 11, 0.1)",
                                  background: "linear-gradient(135deg, rgba(245, 158, 11, 0.12) 0%, transparent 50%)",
                                  textShadow: "0 0 1px rgba(245, 158, 11, 0.5), 1px 1px 0 rgba(0,0,0,0.2)",
                                }}
                              >
                                UNVERIFIED
                              </span>
                            ) : stats.isTrueVerdict ? (
                              <img
                                src={typeof trueSvg === "string" ? trueSvg : trueSvg.src}
                                alt="True"
                                className="inline-block h-[4.4rem] w-auto max-w-[220px] -rotate-2 object-contain"
                              />
                            ) : (
                              <img
                                src={typeof falseSvg === "string" ? falseSvg : falseSvg.src}
                                alt="False"
                                className="inline-block h-[4.4rem] w-auto max-w-[220px] rotate-2 object-contain"
                              />
                            )}
                          </div>
                          <div>
                            {stats.isUnverifiable ? (
                              <p className="text-sm text-amber-400/90 font-medium">
                                Not enough information to verify
                              </p>
                            ) : null}
                            {result.explanation && (
                              <p className="text-sm text-zinc-400 leading-relaxed">
                                {renderFormattedExplanation(result.explanation)}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="relevant-sources w-full min-w-0 overflow-hidden rounded-xl border border-white/10 bg-white/[0.03] backdrop-blur-xl p-6">
                          <span className="text-xs uppercase tracking-wider text-zinc-500 block mb-3">
                            Relevant sources
                          </span>
                          {otherSources.length > 0 ? (
                            <ul className="min-w-0 w-full space-y-2 overflow-hidden">
                              {otherSources.slice(0, 10).map((p, i) => {
                                const domain = getDomain(p.link);
                                const faviconUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
                                return (
                                  <li key={i} className="min-w-0 w-full overflow-hidden">
                                    <a
                                      href={p.link}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="flex w-full min-w-0 items-center gap-3 overflow-hidden rounded-full bg-white/[0.06] px-4 py-2.5 text-left transition-colors hover:bg-white/[0.1]"
                                    >
                                      <img
                                        src={faviconUrl}
                                        alt=""
                                        className="h-4 w-4 shrink-0 rounded-sm object-contain"
                                        aria-hidden
                                      />
                                      <span className="shrink-0 text-xs text-zinc-500">
                                        {domain}
                                      </span>
                                      <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-sm text-zinc-400" title={p.title || undefined}>
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

                      {/* Right 1/3: Score | About this image | Cross-examination */}
                      <div className="flex flex-col gap-6">
                        <div className="rounded-xl border border-white/10 bg-white/[0.03] backdrop-blur-xl p-6">
                          <span className="text-xs uppercase tracking-wider text-zinc-500 block mb-2">
                            Score
                          </span>
                          {stats.isUnverifiable ? (
                            <p className="text-2xl font-display text-zinc-500">—</p>
                          ) : (
                            <p className="font-display tracking-tight leading-tight">
                              <span className="text-4xl sm:text-5xl font-black text-white">{stats.displayPct}%</span>
                              <span className="ml-1.5 text-s text-zinc-500">{stats.scoreInterpretation}</span>
                            </p>
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
                            Cross-examination
                          </span>
                          {factCheckSources.length > 0 ? (
                            <ul className="min-w-0 w-full space-y-2 overflow-hidden">
                              {factCheckSources.map((p, i) => {
                                const domain = getDomain(p.link);
                                const faviconUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
                                return (
                                  <li key={i} className="min-w-0 w-full overflow-hidden">
                                    <a
                                      href={p.link}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="flex w-full min-w-0 items-center gap-3 overflow-hidden rounded-full bg-white/[0.06] px-4 py-2.5 text-left transition-colors hover:bg-white/[0.1]"
                                    >
                                      <img
                                        src={faviconUrl}
                                        alt=""
                                        className="h-4 w-4 shrink-0 rounded-sm object-contain"
                                        aria-hidden
                                      />
                                      <span className="shrink-0 text-xs text-zinc-500">
                                        {p.source || domain}
                                      </span>
                                      <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-sm text-zinc-400" title={p.title || undefined}>
                                        {p.title || "Untitled"}
                                      </span>
                                    </a>
                                  </li>
                                );
                              })}
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
            <p className="mx-auto mt-12 max-w-5xl text-center text-xs text-zinc-500 leading-relaxed shadow-[0_4px_14px_rgba(0,0,0,0.25)]">
              This analysis was generated with the help of AI. AI can make mistakes. Consider checking important information against primary sources.
            </p>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
