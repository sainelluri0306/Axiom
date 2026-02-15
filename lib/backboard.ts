/**
 * Backboard API – second opinion when Bedrock returns UNVERIFIED.
 * Only called for borderline cases to improve accuracy without adding delay for most requests.
 * Fails gracefully: any error returns null and we keep the original verdict.
 */

const BACKBOARD_TIMEOUT_MS = 3500;

export type BackboardVerdict = { verdict: string; score: number };

/**
 * Request a second-opinion verdict from Backboard when primary analysis returned UNVERIFIED.
 * Returns null on any error or timeout – caller keeps original result.
 */
export async function getBackboardSecondOpinion(
  claim: string,
  searchContextSummary: string,
  apiKey: string | undefined
): Promise<BackboardVerdict | null> {
  if (!apiKey?.trim()) return null;

  const prompt = `You are a dispassionate fact-checking analyst. Your goal is not to balance opinions, but to verify the chronological origin of the media. Prioritize primary source dates over commentary. Use precise, clinical language. Avoid emotive adjectives. Based on the claim and evidence below, give a verdict.

Claim: "${claim}"

Evidence summary:
${searchContextSummary.slice(0, 1500)}

Respond with ONLY valid JSON, no markdown:
{"verdict":"TRUE"|"FALSE"|"UNVERIFIED","score":number 0-100 where higher=more FALSE}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), BACKBOARD_TIMEOUT_MS);

    const res = await fetch("https://api.backboard.io/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey.trim()}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 150,
        temperature: 0.1,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    if (!res.ok) return null;

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data?.choices?.[0]?.message?.content?.trim();
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
