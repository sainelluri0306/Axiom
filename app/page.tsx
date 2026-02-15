"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import Nav from "@/components/Nav";

type TimelineNode = {
  label: string;
  date: string;
  description: string;
  link: string;
};

const HERO_PHRASES = [
  "email",
  "instagram posts",
  "twitter posts",
  "articles",
  "images",
  "news",
  "videos",
  "reddit posts",
  "screenshots",
  "links",
];

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

  /* Chatbot-style hero input: image + text */
  const [heroImagePreview, setHeroImagePreview] = useState<string | null>(null);
  const [heroImageSourceUrl, setHeroImageSourceUrl] = useState<string | null>(null);
  const [heroText, setHeroText] = useState("");
  const [heroInputFocused, setHeroInputFocused] = useState(false);
  const heroFileInputRef = useRef<HTMLInputElement>(null);
  const heroTextareaRef = useRef<HTMLTextAreaElement>(null);

  /* Typing animation: "Trace the Origin of " + cycling words — only when empty, no image, and not focused */
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
        if (animatedWord.length > 0) {
          setAnimatedWord(animatedWord.slice(0, -1));
        } else {
          setIsDeleting(false);
          setPhraseIndex((i) => (i + 1) % HERO_PHRASES.length);
        }
      } else {
        if (animatedWord.length < phrase.length) {
          setAnimatedWord(phrase.slice(0, animatedWord.length + 1));
        } else {
          setIsDeleting(true);
        }
      }
    }, delay);

    return () => window.clearTimeout(timeout);
  }, [phraseIndex, isDeleting, animatedWord]);

  /* Auto-grow textarea: 1 line when empty, up to 6 lines then scroll */
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
    const minH = lineHeight;
    const maxH = lineHeight * 6;
    const h = Math.min(maxH, Math.max(minH, ta.scrollHeight));
    ta.style.height = `${h}px`;
    ta.style.overflowY = ta.scrollHeight > maxH ? "scroll" : "hidden";
  }, [heroText]);

  function isImageUrl(s: string): boolean {
    const t = s.trim();
    return /^https?:\/\/\S+$/i.test(t) && t.length < 2048;
  }

  function handleHeroImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (heroImagePreview?.startsWith("blob:")) URL.revokeObjectURL(heroImagePreview);
    setHeroImagePreview(URL.createObjectURL(file));
    setHeroImageSourceUrl(null);
  }

  function removeHeroImage() {
    if (heroImagePreview?.startsWith("blob:")) URL.revokeObjectURL(heroImagePreview);
    setHeroImagePreview(null);
    setHeroImageSourceUrl(null);
    if (heroFileInputRef.current) heroFileInputRef.current.value = "";
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

              {/* Chatbot-style input: image preview + text + bottom bar */}
              <div
                className="chat-input-box mt-10 w-full max-w-2xl sm:mt-12"
                onPaste={handleHeroPaste}
              >
                <input
                  ref={heroFileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  aria-hidden
                  onChange={handleHeroImageChange}
                />
                <div className="flex flex-col gap-3 p-3">
                  {heroImagePreview && (
                    <div className="group relative w-fit">
                      <img
                        src={heroImagePreview}
                        alt="Upload preview"
                        className="h-24 w-auto rounded-lg object-cover sm:h-28"
                      />
                      <div className="absolute bottom-0 left-0 right-0 rounded-b-lg bg-black/85 px-2 py-1.5 opacity-0 transition group-hover:opacity-100">
                        <span className="block truncate text-xs text-white" title={heroImageSourceUrl ?? "Uploaded image"}>
                          {heroImageSourceUrl ?? "Uploaded image"}
                        </span>
                      </div>
                      <div className="absolute right-1 top-1 z-10 flex gap-1">
                        <button
                          type="button"
                          onClick={() => heroFileInputRef.current?.click()}
                          className="flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-zinc-800 transition hover:bg-white"
                          aria-label="Edit image"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={removeHeroImage}
                          className="flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-zinc-800 transition hover:bg-white"
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
                      <div
                        className="pointer-events-none absolute inset-0 flex items-center px-0 py-3 text-sm text-zinc-500"
                        aria-hidden="true"
                      >
                        <span className="whitespace-pre">
                          Trace the Origin of{" "}
                          <span className="text-zinc-400">
                            {animatedWord}
                            <span className="hero-cursor" />
                          </span>
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
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between border-t border-white/[0.06] px-3 py-2">
                  <button
                    type="button"
                    onClick={() => heroFileInputRef.current?.click()}
                    className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-300 transition hover:bg-white/10 hover:text-zinc-100"
                    aria-label="Upload image"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    Upload
                  </button>
                  <button
                    type="button"
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-zinc-900 transition hover:bg-zinc-200"
                    aria-label="Send"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                    </svg>
                  </button>
                </div>
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
