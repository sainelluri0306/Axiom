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

  const prompt = `You are a dispassionate fact-checking analyst. Your goal is not to balance opinions, but to verify the chronological origin of the media. Prioritize primary source dates over commentary. Use precise, clinical language. Avoid emotive adjectives. Based on the claim and evidence below, give a verdict.

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

/** Input for fact-check relevance filtering. */
export type FactCheckEntry = { title: string; snippet: string | null; link: string; source: string };

const GEMINI_FILTER_TIMEOUT_MS = 5000;

/**
 * Use Gemini to filter fact-check sources to only those relevant to the claim/topic.
 * Returns only entries whose content is about the same topic as the claim.
 * On error or missing API key, returns the original list (fail open).
 */
export async function filterRelevantFactChecks<T extends FactCheckEntry>(
  claim: string,
  entries: T[],
  apiKey: string | undefined
): Promise<T[]> {
  if (!apiKey?.trim() || entries.length === 0) return entries;
  if (entries.length > 20) {
    entries = entries.slice(0, 20);
  }

  const list = entries
    .map(
      (e, i) =>
        `[${i}] Title: ${e.title}\n    Snippet: ${(e.snippet ?? "").slice(0, 200)}\n    Link: ${e.link}`
    )
    .join("\n\n");

  const prompt = `You are a fact-check relevance filter. Use precise, clinical language. Given a claim/topic and a list of fact-check articles, identify which ones are ABOUT the same claim or topic.

Claim/Topic: "${claim.slice(0, 500)}"

Fact-check articles (each has index [N]):
${list}

Return ONLY a JSON array of the indices that are RELEVANT to the claim (e.g. [0,2,4]). Include an index only if the article's title or snippet clearly addresses the same claim, person, event, or topic. Exclude tangentially related or off-topic articles.
Example: [0,2,4]`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GEMINI_FILTER_TIMEOUT_MS);

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(apiKey.trim())}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: 200,
            temperature: 0,
          },
        }),
        signal: controller.signal,
      }
    );

    clearTimeout(timeout);
    if (!res.ok) return entries;

    const data = (await res.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) return entries;

    const parsed = JSON.parse(text) as number[];
    if (!Array.isArray(parsed)) return entries;

    const validIndices = new Set(
      parsed.filter((n) => typeof n === "number" && n >= 0 && n < entries.length)
    );
    return entries.filter((_, i) => validIndices.has(i));
  } catch {
    return entries;
  }
}
