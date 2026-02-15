import { NextRequest, NextResponse } from "next/server";
import axios from "axios";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { getBackboardSecondOpinion } from "@/lib/backboard";
import { filterRelevantFactChecks, getGeminiSecondOpinion } from "@/lib/gemini";

const SERPAPI_BASE = "https://serpapi.com/search.json";
const FACT_CHECK_API = "https://factchecktools.googleapis.com/v1alpha1/claims:search";
const BEDROCK_MODEL_ID = "global.anthropic.claude-sonnet-4-20250514-v1:0";

export type FactCheckResult = {
  claim: string;
  claimant?: string;
  claimDate?: string;
  rating: string;
  publisher: string;
  url: string;
  title?: string;
};

export type AnalyzeTextBody = {
  claim: string;
};

export type PageResultItem = {
  date: string;
  link: string;
  title: string;
  snippet: string | null;
  source: string;
};

export type TimelineNode = {
  label: string;
  date: string;
  description: string;
  link: string;
};

export type TextAnalysisResult = {
  verdict: string;
  score: number;
  explanation: string;
  timeline: TimelineNode[];
  /** Search results from web + news + Politifact + Snopes. */
  pageResults: PageResultItem[];
};

interface SerpOrganicResult {
  title?: string;
  link?: string;
  snippet?: string;
  date?: string;
  displayed_link?: string;
}

interface SerpNewsResult {
  title?: string;
  link?: string;
  snippet?: string;
  date?: string;
  source?: { name?: string };
}

async function runSerpSearch(
  apiKey: string,
  query: string,
  extraParams?: Record<string, string>
): Promise<SerpOrganicResult[]> {
  const params = new URLSearchParams({
    engine: "google",
    q: query,
    api_key: apiKey,
    ...extraParams,
  });
  try {
    const res = await axios.get<{ organic_results?: SerpOrganicResult[] }>(
      `${SERPAPI_BASE}?${params.toString()}`,
      { timeout: 20000 }
    );
    return res.data?.organic_results ?? [];
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.data) {
      const msg = typeof err.response.data === "object" && err.response.data !== null && "error" in err.response.data
        ? String((err.response.data as { error?: string }).error)
        : JSON.stringify(err.response.data);
      throw new Error(`SerpAPI Google: ${err.response.status} ${msg}`);
    }
    throw err;
  }
}

async function runSerpNewsSearch(apiKey: string, query: string): Promise<SerpNewsResult[]> {
  const params = new URLSearchParams({
    engine: "google_news",
    q: query,
    api_key: apiKey,
  });
  try {
    const res = await axios.get<{ news_results?: SerpNewsResult[] }>(
      `${SERPAPI_BASE}?${params.toString()}`,
      { timeout: 20000 }
    );
    return res.data?.news_results ?? [];
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.data) {
      const msg = typeof err.response.data === "object" && err.response.data !== null && "error" in err.response.data
        ? String((err.response.data as { error?: string }).error)
        : JSON.stringify(err.response.data);
      throw new Error(`SerpAPI Google News: ${err.response.status} ${msg}`);
    }
    throw err;
  }
}

/** Google Fact Check Tools API — returns structured verdicts from PolitiFact, Snopes, etc. */
async function fetchFactChecks(
  apiKey: string,
  query: string
): Promise<FactCheckResult[]> {
  try {
    const res = await axios.get<{
      claims?: Array<{
        text?: string;
        claimant?: string;
        claimDate?: string;
        claimReview?: Array<{
          publisher?: { name?: string; site?: string };
          url?: string;
          title?: string;
          textualRating?: string;
        }>;
      }>;
    }>(`${FACT_CHECK_API}`, {
      params: { key: apiKey, query },
      timeout: 15000,
    });
    const results: FactCheckResult[] = [];
    for (const c of res.data?.claims ?? []) {
      for (const r of c.claimReview ?? []) {
        if (r.url && r.textualRating) {
          results.push({
            claim: c.text ?? "",
            claimant: c.claimant,
            claimDate: c.claimDate,
            rating: r.textualRating,
            publisher: r.publisher?.name ?? "Unknown",
            url: r.url,
            title: r.title,
          });
        }
      }
    }
    return results;
  } catch {
    return [];
  }
}

function toPageResult(r: SerpOrganicResult | SerpNewsResult, source: string): PageResultItem {
  return {
    title: typeof r.title === "string" ? r.title : "Untitled",
    link: typeof r.link === "string" ? r.link : "",
    snippet: typeof r.snippet === "string" ? r.snippet : null,
    date: typeof r.date === "string" ? r.date : "N/A",
    source,
  };
}

/** Normalize timeline date to "Mon DD, YYYY" so the year is always present. */
function formatTimelineDate(s: string): string {
  if (!s || s === "N/A") return "N/A";
  const raw = s.trim();
  const hasYear = /\b(19|20)\d{2}\b/.test(raw);
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) {
    const mon = d.toLocaleString("en-US", { month: "short" });
    const day = d.getDate();
    const year = d.getFullYear();
    return `${mon} ${day}, ${year}`;
  }
  if (!hasYear) {
    const year = new Date().getFullYear();
    return `${raw}, ${year}`;
  }
  return raw;
}

/** Extract verdict from fact-check result snippets (PolitiFact, Snopes, etc.). */
function verdictFromSnippets(
  results: PageResultItem[],
  factCheckSources: string[]
): { verdict: string; score: number } | null {
  const combined = results
    .filter((p) => factCheckSources.includes(p.source))
    .map((p) => `${p.title} ${p.snippet ?? ""}`)
    .join(" ")
    .toLowerCase();
  if (!combined) return null;
  const falseMatch = /(?:rated?|rate|rates)\s+(?:as\s+)?(?:false|pants\s*[- ]?on\s*fire|pants\s*on\s*fire|full\s*flop)|(?:false|pants\s*on\s*fire|debunked|fake|hoax|misleading)/.test(combined) ||
    /\b(?:false|debunked|misleading|incorrect)\b.*(?:politifact|snopes|factcheck|afp)/.test(combined);
  const trueMatch = /(?:rated?|rate|rates)\s+(?:as\s+)?(?:true|mostly\s*true|promise\s*kept)|(?:true|mostly\s*true|correct|accurate)/.test(combined) ||
    /\b(?:true|mostly\s*true|correct)\b.*(?:politifact|snopes|factcheck|afp)/.test(combined);
  const mixedMatch = /(?:half\s*true|mixed|partly\s*true|partly\s*false)/.test(combined);
  if (falseMatch && !trueMatch) return { verdict: "FALSE", score: 88 };
  if (trueMatch && !falseMatch) return { verdict: "TRUE", score: 15 };
  if (mixedMatch && !falseMatch && !trueMatch) return { verdict: "MOSTLY FALSE", score: 65 };
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Partial<AnalyzeTextBody>;
    const claim = body?.claim?.trim();

    if (!claim) {
      return NextResponse.json(
        { error: "Missing claim" },
        { status: 400 }
      );
    }

    const apiKey = process.env.SERPAPI_KEY?.trim();
    if (!apiKey) {
      return NextResponse.json(
        { error: "SERPAPI_KEY not configured" },
        { status: 500 }
      );
    }

    // —— Step A: Search web + news + fact-check sites ——
    // General web (1yr) + News + fact-check sites — no date limit on fact-checkers (older debunks matter)
    const factCheckKey = process.env.GOOGLE_FACT_CHECK_API_KEY?.trim();
    const shortClaim = claim.length > 80 ? claim.slice(0, 80) : claim;
    const [factCheckRes1, factCheckRes2, generalRes, newsRes, factCheckSearchRes, politifactRes, snopesRes, factcheckOrgRes, afpRes] =
      await Promise.all([
        factCheckKey ? fetchFactChecks(factCheckKey, claim) : Promise.resolve([] as FactCheckResult[]),
        factCheckKey && claim !== shortClaim ? fetchFactChecks(factCheckKey, shortClaim) : Promise.resolve([] as FactCheckResult[]),
        runSerpSearch(apiKey, claim, { as_qdr: "y1" }), // 1 year — many fact-checks are months old
        runSerpNewsSearch(apiKey, claim),
        runSerpSearch(apiKey, `${claim} fact check`),
        runSerpSearch(apiKey, `site:politifact.com ${claim}`),
        runSerpSearch(apiKey, `site:snopes.com ${claim}`),
        runSerpSearch(apiKey, `site:factcheck.org ${claim}`),
        runSerpSearch(apiKey, `site:factcheck.afp.com ${claim}`),
      ]);

    const factCheckRes = [...factCheckRes1];
    for (const f of factCheckRes2) {
      if (!factCheckRes.some((e) => e.url === f.url)) factCheckRes.push(f);
    }

    const pageResults: PageResultItem[] = [
      ...generalRes.slice(0, 12).map((r) => toPageResult(r, "Web")),
      ...newsRes.slice(0, 12).map((r) => toPageResult(r, "News")),
      ...factCheckSearchRes.slice(0, 10).map((r) => toPageResult(r, "FactCheck")),
      ...politifactRes.slice(0, 10).map((r) => toPageResult(r, "PolitiFact")),
      ...snopesRes.slice(0, 10).map((r) => toPageResult(r, "Snopes")),
      ...factcheckOrgRes.slice(0, 8).map((r) => toPageResult(r, "FactCheck.org")),
      ...afpRes.slice(0, 8).map((r) => toPageResult(r, "AFP")),
    ];

    // Dedupe by link
    const seen = new Set<string>();
    const uniqueResults = pageResults.filter((p) => {
      if (!p.link || seen.has(p.link)) return false;
      seen.add(p.link);
      return true;
    });

    // —— Step B: AWS Bedrock (Claude) analysis ——
    const accessKeyId = process.env.AWS_BEDROCK_ACCESS_KEY_ID?.trim() ?? process.env.AWS_ACCESS_KEY_ID?.trim();
    const secretAccessKey = process.env.AWS_BEDROCK_SECRET_ACCESS_KEY?.trim() ?? process.env.AWS_BEDROCK_KEY?.trim();
    if (!accessKeyId || !secretAccessKey) {
      return NextResponse.json(
        {
          error: "AWS Bedrock credentials not configured.",
          hint: "Set AWS_BEDROCK_ACCESS_KEY_ID and AWS_BEDROCK_SECRET_ACCESS_KEY in .env.local.",
        },
        { status: 500 }
      );
    }
    const region = process.env.AWS_REGION ?? "us-east-1";
    const client = new BedrockRuntimeClient({
      region,
      credentials: { accessKeyId, secretAccessKey },
    });

    const searchContextText = uniqueResults
      .map(
        (p) =>
          `[${p.source}] ${p.title} | ${p.date} | snippet: ${p.snippet ?? "(none)"} | link: ${p.link}`
      )
      .join("\n");

    const factCheckContext =
      factCheckRes.length > 0
        ? `\n\nGOOGLE FACT CHECK API (authoritative — USE THESE VERDICTS):\n` +
          factCheckRes
            .slice(0, 10)
            .map(
              (f) =>
                `- Publisher: ${f.publisher} | Rating: ${f.rating} | URL: ${f.url} | Claim: ${f.claim.slice(0, 100)}...`
            )
            .join("\n")
        : "";

    const userPrompt = `You are a dispassionate fact-checking analyst. Your goal is not to balance opinions, but to verify the chronological origin of the media. Prioritize primary source dates over commentary. Use precise, clinical language. Avoid emotive adjectives. Give ACCURATE verdicts. Avoid UNVERIFIED when evidence exists.

Analyze the claim and search results above. Base your verdict on the evidence:
- If Google Fact Check API returned ratings, weigh them heavily.
- Compare the claim against Web, News, and fact-check sources. Do sources corroborate, contradict, or leave it unaddressed?
- Evaluate each case on its merits. Do not apply rigid rules—reason from the evidence provided.
- UNVERIFIED only when there is genuinely insufficient evidence to reach a conclusion.

Claim: "${claim}"

${factCheckContext}

SEARCH RESULTS (use these links for timeline):
${searchContextText || "No search results found."}

RULES: Only evaluate what the user claimed. Do not invent errors. Trust majority of sources.
For the timeline: use the exact "date" from the SEARCH RESULTS lines above when a node corresponds to that result. Every timeline date must include the year (e.g. "Jan 15, 2024").
Verdict: TRUE | FALSE | UNVERIFIED (only when genuinely insufficient evidence).
Score 0-100: higher = more FALSE.

In the explanation string you may use ** for bold on important terms. For links, use [display text](url) only for Wikipedia (or similar reference) pages for people and institutions—do not link to news articles or sources that already appear in the timeline or Relevant sources. Escape any quotes inside the string. Return ONLY valid JSON, no code fences. Use this exact structure:
{"verdict":"string","score":number 0-100,"explanation":"string","timeline":[{"label":"string","date":"string","description":"string","link":"string"}]}`;

    const bedrockBody = {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 1024,
      temperature: 0.2,
      messages: [
        {
          role: "user" as const,
          content: [{ type: "text" as const, text: userPrompt }],
        },
      ],
    };

    const command = new InvokeModelCommand({
      modelId: BEDROCK_MODEL_ID,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify(bedrockBody),
    });

    const response = await client.send(command);
    const responseBody = response.body;
    if (!responseBody) {
      return NextResponse.json(
        { error: "Empty response from Bedrock" },
        { status: 500 }
      );
    }

    const responseText = new TextDecoder().decode(responseBody);
    let parsed: Partial<TextAnalysisResult>;
    try {
      const envelope = JSON.parse(responseText) as { content?: { type?: string; text?: string }[] };
      const text =
        envelope?.content?.[0]?.type === "text" && typeof envelope.content[0].text === "string"
          ? envelope.content[0].text
          : responseText;
      parsed = JSON.parse(text) as Partial<TextAnalysisResult>;
    } catch {
      try {
        parsed = JSON.parse(responseText) as Partial<TextAnalysisResult>;
      } catch {
        return NextResponse.json(
          { error: "Could not parse Bedrock response as JSON", raw: responseText.slice(0, 500) },
          { status: 500 }
        );
      }
    }

    const timelineRaw = (Array.isArray(parsed.timeline) ? parsed.timeline : []) as unknown[];
    const timelineNodes: TimelineNode[] = timelineRaw
      .filter((t): t is Record<string, unknown> => t != null && typeof t === "object")
      .map((t) => {
        const dateStr = typeof t.date === "string" ? t.date : "N/A";
        return {
          label: typeof t.label === "string" ? t.label : "Event",
          date: formatTimelineDate(dateStr),
          description: typeof t.description === "string" ? t.description : "",
          link: typeof t.link === "string" ? t.link : "",
        };
      });

    let verdict = typeof parsed.verdict === "string" ? parsed.verdict : "UNVERIFIED";
    let score = typeof parsed.score === "number" ? Math.min(100, Math.max(0, parsed.score)) : 50;
    let explanation = typeof parsed.explanation === "string" ? parsed.explanation : "";

    // Override UNVERIFIED when Fact Check API has clear verdicts
    if (
      factCheckRes.length > 0 &&
      verdict.toUpperCase().includes("UNVERIFIED")
    ) {
      const ratings = factCheckRes.map((f) => f.rating.toLowerCase());
      const falseIndicators = ["false", "pants on fire", "pants-fire", "full flop", "fake", "hoax", "debunk", "misleading"];
      const trueIndicators = ["true", "mostly true", "correct", "accurate", "promise kept"];
      const falseCount = ratings.filter((r) => falseIndicators.some((i) => r.includes(i))).length;
      const trueCount = ratings.filter((r) => trueIndicators.some((i) => r.includes(i))).length;
      if (falseCount > trueCount) {
        verdict = "FALSE";
        score = 90;
        if (!explanation) {
          explanation = `Fact-checkers (${factCheckRes.slice(0, 3).map((f) => f.publisher).join(", ")}) rate this claim as false.`;
        }
      } else if (trueCount > falseCount) {
        verdict = "TRUE";
        score = 15;
        if (!explanation) {
          explanation = `Fact-checkers rate this claim as true or mostly true.`;
        }
      }
    }

    // Override UNVERIFIED when PolitiFact/Snopes/FactCheck snippets contain clear verdicts
    if (verdict.toUpperCase().includes("UNVERIFIED")) {
      const snippetVerdict = verdictFromSnippets(uniqueResults, ["PolitiFact", "Snopes", "FactCheck", "FactCheck.org", "AFP"]);
      if (snippetVerdict) {
        verdict = snippetVerdict.verdict;
        score = snippetVerdict.score;
        if (!explanation) {
          explanation = `Fact-check search results indicate this claim has been rated ${snippetVerdict.verdict}.`;
        }
      }
    }

    // Backboard + Gemini second opinion: only when still UNVERIFIED (parallel for speed)
    if (verdict.toUpperCase().includes("UNVERIFIED")) {
      const context = searchContextText || factCheckContext || "No search results.";
      const [backboard, gemini] = await Promise.all([
        getBackboardSecondOpinion(claim, context, process.env.BACKBOARD_API_KEY?.trim()),
        getGeminiSecondOpinion(claim, context, process.env.GEMINI_API_KEY?.trim()),
      ]);
      const secondOpinion = backboard || gemini;
      if (secondOpinion) {
        verdict = secondOpinion.verdict;
        score = secondOpinion.score;
        if (!explanation) {
          explanation = `Second-opinion analysis suggests ${secondOpinion.verdict}.`;
        }
      }
    }

    // Filter fact-check sources to only those relevant to the claim (Gemini)
    const factCheckSourceNames = ["PolitiFact", "Snopes", "FactCheck", "FactCheck.org", "AFP"];
    const nonFactCheck = uniqueResults.filter((p) => !factCheckSourceNames.includes(p.source));
    const factChecks = uniqueResults.filter((p) => factCheckSourceNames.includes(p.source));
    const filteredFactChecks = await filterRelevantFactChecks(
      claim,
      factChecks,
      process.env.GEMINI_API_KEY?.trim()
    );
    const pageResultsFiltered = [...nonFactCheck, ...filteredFactChecks];

    const result: TextAnalysisResult = {
      verdict,
      score,
      explanation,
      timeline: timelineNodes,
      pageResults: pageResultsFiltered,
    };

    return NextResponse.json(result);
  } catch (err) {
    console.error("Analyze-text API error:", err);
    const message = err instanceof Error ? err.message : "Analysis failed";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
