/**
 * Gemini API – second opinion when Bedrock returns UNVERIFIED.
 * Fast, accurate model for verification. Fails gracefully.
 */

const GEMINI_TIMEOUT_MS = 3000;

export type GeminiVerdict = { verdict: string; score: number };

/**
 * Request a second-opinion verdict from Gemini when primary analysis returned UNVERIFIED.
 * Returns null on any error or timeout.
 */
export async function getGeminiSecondOpinion(
  claim: string,
  searchContextSummary: string,
  apiKey: string | undefined
): Promise<GeminiVerdict | null> {
  if (!apiKey?.trim()) return null;

  const prompt = `You are a fact-checking analyst. Based on the claim and evidence below, give a verdict.

Claim: "${claim}"

Evidence summary:
${searchContextSummary.slice(0, 1500)}

Respond with ONLY valid JSON, no markdown:
{"verdict":"TRUE"|"FALSE"|"UNVERIFIED","score":number 0-100 where higher=more FALSE}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(apiKey.trim())}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: 150,
            temperature: 0.1,
          },
        }),
        signal: controller.signal,
      }
    );

    clearTimeout(timeout);
    if (!res.ok) return null;

    const data = (await res.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) return null;

    const parsed = JSON.parse(text) as { verdict?: string; score?: number };
    const v = String(parsed?.verdict ?? "").toUpperCase();
    const score =
      typeof parsed?.score === "number"
        ? Math.min(100, Math.max(0, parsed.score))
        : 50;

    if (v.includes("TRUE") && !v.includes("FALSE"))
      return { verdict: "TRUE", score: Math.min(score, 25) };
    if (v.includes("FALSE")) return { verdict: "FALSE", score: Math.max(score, 85) };
    return null;
  } catch {
    return null;
  }
}
