"use client";

import { useState } from "react";
import Link from "next/link";

export default function TestPage() {
  const [imageUrl, setImageUrl] = useState("");
  const [userClaim, setUserClaim] = useState("");
  const [loading, setLoading] = useState(false);
  const [rawResponse, setRawResponse] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

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
      const data = await res.json();
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
        <div className="flex items-center gap-4">
          <Link href="/" className="text-zinc-400 hover:text-white text-sm">
            ← Home
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
