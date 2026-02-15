import { NextRequest, NextResponse } from "next/server";
import axios from "axios";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

const SERPAPI_BASE = "https://serpapi.com/search.json";
const BEDROCK_MODEL_ID = "global.anthropic.claude-sonnet-4-20250514-v1:0";

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

function toPageResult(r: SerpOrganicResult | SerpNewsResult, source: string): PageResultItem {
  return {
    title: typeof r.title === "string" ? r.title : "Untitled",
    link: typeof r.link === "string" ? r.link : "",
    snippet: typeof r.snippet === "string" ? r.snippet : null,
    date: typeof r.date === "string" ? r.date : "N/A",
    source,
  };
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

    // —— Step A: Search web + news + Politifact + Snopes ——
    // General web (with recency) + Google News for latest coverage + fact-check sites
    const [generalRes, newsRes, politifactRes, snopesRes] = await Promise.all([
      runSerpSearch(apiKey, claim, { as_qdr: "d2" }), // past 48 hours for recent content (SerpAPI param)
      runSerpNewsSearch(apiKey, claim),
      runSerpSearch(apiKey, `site:politifact.com ${claim}`),
      runSerpSearch(apiKey, `site:snopes.com ${claim}`),
    ]);

    const pageResults: PageResultItem[] = [
      ...generalRes.slice(0, 15).map((r) => toPageResult(r, "Web")),
      ...newsRes.slice(0, 15).map((r) => toPageResult(r, "News")),
      ...politifactRes.slice(0, 10).map((r) => toPageResult(r, "PolitiFact")),
      ...snopesRes.slice(0, 10).map((r) => toPageResult(r, "Snopes")),
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

    const userPrompt = `You are a fact-checking analyst. Analyze ONLY what the user actually claimed.

SOURCES: Web, News, PolitiFact, Snopes, social media (valid for breaking news).

STRICT RULES — follow exactly:
1. ONLY evaluate claims the user ACTUALLY made. Do NOT introduce facts the claim did not mention, and do NOT penalize for them. If the claim says "Crew-12 launched with X, Y, Z" — verify X, Y, Z. Ignore extraneous details you infer.
2. Core claim = main factual assertions (who, what, when, where). If MULTIPLE sources confirm the core claim, verdict MUST be TRUE or MOSTLY TRUE with score 5-30.
3. ONE conflicting source vs. MANY confirming sources → trust the majority. A single outlier (e.g. different crew name from one article) does NOT override multiple corroborating sources.
4. Tangential details (who praised whom, job titles, administrative roles) are NOT core. Do NOT downgrade to FALSE/MOSTLY FALSE for administrative asides. Reserve FALSE for when the CORE claim is contradicted.
5. Do NOT invent errors. If the claim did not mention "Jared Isaacman" or "NASA Administrator," do not penalize for that.
6. 48-HOUR WINDOW: We only search the past 48 hours. If the claim is about recent events AND you find sufficient evidence/sources that clearly corroborate or contradict it → proceed with TRUE/MOSTLY TRUE or FALSE/MOSTLY FALSE. If the claim is within 48 hours BUT search results are sparse, irrelevant, or lack enough coverage to verify → use verdict "TOO RECENT TO VALIDATE" with score 50. Do NOT guess when evidence is insufficient. Explain: "This claim appears to be about very recent events. There is not enough coverage or fact-checking available yet to validate it. Try again in a few hours or days when more sources have reported on this."

Claim to verify: "${claim}"

Search results — use these exact link URLs for timeline nodes:
${searchContextText || "No search results found."}

Decision: (a) Enough sources to verify → TRUE/MOSTLY TRUE (5-30) or FALSE/MOSTLY FALSE (70-100). (b) Claim is recent but insufficient evidence → TOO RECENT TO VALIDATE (50). (c) Unclear → MIXED/UNVERIFIED (40-60).
Score 0-100: higher = more FALSE.

Build a timeline. Use links from the list above. Return ONLY valid JSON, no markdown:
{"verdict":"string","score":number 0-100,"explanation":"string","timeline":[{"label":"short label","date":"date or N/A","description":"1-2 sentences","link":"URL or empty string"}]}`;

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
      .map((t) => ({
        label: typeof t.label === "string" ? t.label : "Event",
        date: typeof t.date === "string" ? t.date : "N/A",
        description: typeof t.description === "string" ? t.description : "",
        link: typeof t.link === "string" ? t.link : "",
      }));

    const result: TextAnalysisResult = {
      verdict: typeof parsed.verdict === "string" ? parsed.verdict : "UNVERIFIED",
      score: typeof parsed.score === "number" ? Math.min(100, Math.max(0, parsed.score)) : 0,
      explanation: typeof parsed.explanation === "string" ? parsed.explanation : "",
      timeline: timelineNodes,
      pageResults: uniqueResults,
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
