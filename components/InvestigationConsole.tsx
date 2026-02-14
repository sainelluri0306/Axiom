"use client";

import { useState, useRef, useEffect } from "react";

type TabId = "url" | "upload" | "text" | "screenshot";

const tabs: { id: TabId; label: string }[] = [
  { id: "url", label: "URL" },
  { id: "upload", label: "Upload" },
  { id: "text", label: "Text" },
  { id: "screenshot", label: "Screenshot" },
];

export default function InvestigationConsole() {
  const [activeTab, setActiveTab] = useState<TabId>("url");
  const [isDragging, setIsDragging] = useState(false);
  const [tabIndicatorStyle, setTabIndicatorStyle] = useState({ left: 0, width: 0 });
  const tabListRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  /* Sliding underline: measure active tab and set indicator position */
  useEffect(() => {
    const index = tabs.findIndex((t) => t.id === activeTab);
    const el = tabRefs.current[index];
    const list = tabListRef.current;
    if (!el || !list) return;
    const width = el.offsetWidth;
    const left = el.offsetLeft;
    setTabIndicatorStyle({ left, width });
  }, [activeTab]);

  /* Re-measure on resize */
  useEffect(() => {
    const list = tabListRef.current;
    if (!list) return;
    const ro = new ResizeObserver(() => {
      const index = tabs.findIndex((t) => t.id === activeTab);
      const el = tabRefs.current[index];
      if (el) setTabIndicatorStyle({ left: el.offsetLeft, width: el.offsetWidth });
    });
    ro.observe(list);
    return () => ro.disconnect();
  }, [activeTab]);

  return (
    <div
      className="console-inner-shadow gradient-border-glow group rounded-[1.25rem] border border-noir-brass/15 bg-noir-surface/90 shadow-noir-card transition-all duration-300 hover:border-noir-brass/30 hover:shadow-noir-card-hover"
      role="region"
      aria-label="Investigation console"
    >
      {/* Tabs with sliding underline */}
      <div
        ref={tabListRef}
        className="relative flex border-b border-noir-border/60 rounded-t-[1.25rem]"
        role="tablist"
        aria-label="Input type"
      >
        {tabs.map(({ id, label }, i) => (
          <button
            key={id}
            ref={(el) => { tabRefs.current[i] = el; }}
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            aria-controls={`panel-${id}`}
            id={`tab-${id}`}
            onClick={() => setActiveTab(id)}
            className={`relative z-10 flex-1 px-4 py-3.5 text-sm font-medium transition-colors duration-200 ${
              activeTab === id ? "text-noir-brass-light" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {label}
          </button>
        ))}
        <span
          className="absolute bottom-0 h-[2px] rounded-full bg-noir-brass/90 transition-all duration-300 ease-out"
          style={{ left: tabIndicatorStyle.left, width: tabIndicatorStyle.width }}
          aria-hidden="true"
        />
      </div>

      <div className="p-4 sm:p-5">
        {/* URL tab: single row input + Analyze */}
        {activeTab === "url" && (
          <div
            id="panel-url"
            role="tabpanel"
            aria-labelledby="tab-url"
            className="flex flex-col gap-3 sm:flex-row sm:items-stretch"
          >
            <label htmlFor="hero-input" className="sr-only">
              URL or link to trace
            </label>
            <input
              id="hero-input"
              type="url"
              placeholder="Drop a link or media to trace origin…"
              className="min-h-[48px] flex-1 rounded-input border border-noir-border/80 bg-noir-bg/80 px-4 py-3 text-zinc-100 placeholder-zinc-500 focus:border-noir-brass/40 focus:outline-none focus:ring-1 focus:ring-noir-brass/25 transition-all duration-200"
            />
            <button
              type="button"
              className="rounded-pill bg-noir-brass/90 px-8 py-3 text-sm font-semibold tracking-tight text-noir-bg shadow-brass-glow transition-all duration-200 hover:bg-noir-brass hover:shadow-brass-glow-strong focus-visible:ring-2 focus-visible:ring-noir-brass focus-visible:ring-offset-2 focus-visible:ring-offset-noir-surface"
            >
              Analyze
            </button>
          </div>
        )}

        {/* Text tab */}
        {activeTab === "text" && (
          <div id="panel-text" role="tabpanel" aria-labelledby="tab-text" className="space-y-3">
            <label htmlFor="text-input" className="sr-only">
              Text to analyze
            </label>
            <textarea
              id="text-input"
              rows={4}
              placeholder="Drop a link or media to trace origin…"
              className="w-full rounded-input border border-noir-border/80 bg-noir-bg/80 px-4 py-3 text-zinc-100 placeholder-zinc-500 focus:border-noir-brass/40 focus:outline-none focus:ring-1 focus:ring-noir-brass/25 transition-all duration-200"
            />
            <button
              type="button"
              className="w-full rounded-pill bg-noir-brass/90 py-3 text-sm font-semibold tracking-tight text-noir-bg shadow-brass-glow transition-all duration-200 hover:bg-noir-brass hover:shadow-brass-glow-strong focus-visible:ring-2 focus-visible:ring-noir-brass focus-visible:ring-offset-2 focus-visible:ring-offset-noir-surface"
            >
              Analyze
            </button>
          </div>
        )}

        {/* Upload tab */}
        {activeTab === "upload" && (
          <div id="panel-upload" role="tabpanel" aria-labelledby="tab-upload" className="space-y-3">
            <div
              className={`flex min-h-[140px] flex-col items-center justify-center rounded-input border-2 border-dashed px-4 py-8 transition-all duration-200 ${
                isDragging ? "border-noir-brass/40 bg-noir-brass/5" : "border-noir-border/60 bg-noir-bg/50"
              }`}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => { e.preventDefault(); setIsDragging(false); }}
            >
              <p className="mb-2 text-sm text-zinc-500">Drop a link or media to trace origin…</p>
              <p className="mb-4 text-xs text-zinc-600">PDF, HTML, or image — max 10MB</p>
              <label className="cursor-pointer rounded-pill border border-noir-border/80 px-5 py-2.5 text-sm text-zinc-400 transition-all hover:border-noir-brass/40 hover:text-noir-brass-light">
                <span>Choose file</span>
                <input type="file" className="sr-only" accept=".pdf,.html,image/*" aria-label="Choose file" />
              </label>
            </div>
            <button
              type="button"
              className="w-full rounded-pill bg-noir-brass/90 py-3 text-sm font-semibold tracking-tight text-noir-bg shadow-brass-glow transition-all duration-200 hover:bg-noir-brass hover:shadow-brass-glow-strong focus-visible:ring-2 focus-visible:ring-noir-brass focus-visible:ring-offset-2 focus-visible:ring-offset-noir-surface"
            >
              Analyze
            </button>
          </div>
        )}

        {/* Screenshot tab */}
        {activeTab === "screenshot" && (
          <div id="panel-screenshot" role="tabpanel" aria-labelledby="tab-screenshot" className="space-y-3">
            <div className="flex min-h-[140px] flex-col items-center justify-center rounded-input border border-noir-border/60 bg-noir-bg/50 py-8">
              <p className="text-sm text-zinc-500">Drop a link or media to trace origin…</p>
              <p className="mt-1 text-xs text-zinc-600">Screenshot capture coming soon.</p>
            </div>
            <button
              type="button"
              className="w-full rounded-pill bg-noir-brass/90 py-3 text-sm font-semibold tracking-tight text-noir-bg shadow-brass-glow transition-all duration-200 hover:bg-noir-brass hover:shadow-brass-glow-strong focus-visible:ring-2 focus-visible:ring-noir-brass focus-visible:ring-offset-2 focus-visible:ring-offset-noir-surface"
            >
              Analyze
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
