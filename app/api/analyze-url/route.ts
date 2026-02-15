import { NextRequest, NextResponse } from "next/server";
import axios from "axios";
import * as cheerio from "cheerio";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

const SERPAPI_BASE = "https://serpapi.com/search.json";
const BEDROCK_MODEL_ID = "global.anthropic.claude-sonnet-4-20250514-v1:0";

export type AnalyzeUrlBody = {
  url: string;
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

export type UrlAnalysisResult = {
  verdict: string;
  score: number;
  explanation: string;
  timeline: TimelineNode[];
  pageResults: PageResultItem[];
  scrapedContent?: { title: string; description: string; body: string };
};

interface SerpOrganicResult {
  title?: string;
  link?: string;
  snippet?: string;
  date?: string;
}

interface SerpNewsResult {
  title?: string;
  link?: string;
  snippet?: string;
  date?: string;
}

const ARTICLE_SELECTORS = [
  "article",
  "[role='article']",
  "main article",
  ".article-body",
  ".post-content",
  ".article-content",
  ".entry-content",
  ".content-body",
  ".story-body",
  "main",
  ".main-content",
];

/** Try X/Twitter oEmbed when direct scrape fails (X blocks scrapers). */
async function fetchXViaOembed(tweetUrl: string): Promise<{ title: string; description: string; body: string } | null> {
  try {
    const cleanUrl = tweetUrl.replace(/\?.*$/, "");
    const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(cleanUrl)}`;
    const res = await axios.get<{ html?: string; author_name?: string }>(oembedUrl, {
      timeout: 10000,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PaperTrails/1.0)" },
    });
    const html = res.data?.html;
    if (!html) return null;
    const $ = cheerio.load(html);
    const text = $("blockquote").text().trim() || $.text().trim();
    if (!text || text.length < 10) return null;
    return {
      title: `Tweet by ${res.data?.author_name ?? "X user"}`,
      description: text.slice(0, 300),
      body: text,
    };
  } catch {
    return null;
  }
}

async function scrapeUrl(url: string): Promise<{ title: string; description: string; body: string }> {
  const res = await axios.get<string>(url, {
    timeout: 15000,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
    maxRedirects: 5,
    validateStatus: () => true,
  });

  if (res.status >= 400) {
    throw new Error(`Failed to fetch URL (${res.status})`);
  }

  const $ = cheerio.load(res.data);

  // Remove scripts, styles, nav, footer
  $("script, style, nav, footer, header, iframe, noscript").remove();

  const title =
    $('meta[property="og:title"]').attr("content") ||
    $('meta[name="twitter:title"]').attr("content") ||
    $("title").first().text() ||
    "";

  const description =
    $('meta[property="og:description"]').attr("content") ||
    $('meta[name="twitter:description"]').attr("content") ||
    $('meta[name="description"]').attr("content") ||
    "";

  let body = "";
  for (const sel of ARTICLE_SELECTORS) {
    const el = $(sel).first();
    if (el.length) {
      body = el.text().trim();
      if (body.length > 100) break;
    }
  }
  if (!body || body.length < 100) {
    body = $("body").text().trim();
  }

  body = body.replace(/\s+/g, " ").slice(0, 8000);

  // X/Twitter often returns error page instead of content. Try oEmbed fallback.
  const isXUrl = /(?:^https?:\/\/)(?:x\.com|twitter\.com)\//i.test(url);
  const isXErrorPage =
    /something went wrong|privacy related extensions|try again/i.test(body) ||
    (body.length < 200 && /x\.com|twitter/i.test(body));
  if (isXUrl && isXErrorPage) {
    const oembed = await fetchXViaOembed(url);
    if (oembed) return oembed;
  }

  return {
    title: title.trim().slice(0, 500),
    description: description.trim().slice(0, 1000),
    body,
  };
}

/** When URL is from a fact-checker, try to extract verdict from scraped content. */
function detectFactCheckVerdict(
  url: string,
  scraped: { title: string; description: string; body: string }
): { verdict: string; score: number } | null {
  if (!/politifact\.com|snopes\.com|factcheck\.org/i.test(url)) return null;

  const text = `${scraped.title} ${scraped.description} ${scraped.body}`.toLowerCase();

  // PolitiFact/Snopes FALSE indicators (debunking)
  const falsePatterns = [
    /(?:wasn't|was not|is not|were not|didn't|did not)\s+(?:liam|he|she|it|they|the|conejo|ramos)/i,
    /we rate .+ false/i,
    /rated false|rates? (?:this|it) false/i,
    /pants on fire|pants-fire/i,
    /\bfalse\b.*(?:politifact|snopes|fact.?check)/i,
    /(?:that|it) wasn't |(?:that|it) was not |(?:that|it) is not /i,
    /^no,? .+ (?:wasn't|was not|is not)/im,
    /(?:it|that) wasn't (?:conejo|liam|ramos)/i,
  ];
  if (falsePatterns.some((p) => p.test(text))) {
    return { verdict: "FALSE", score: 90 };
  }

  // TRUE indicators
  const truePatterns = [
    /we rate (?:claims? that .+? )?(?:as )?true/i,
    /rated true|rates? (?:this|it) true/i,
    /\btrue\b.*(?:politifact|snopes)/i,
    /mostly true/i,
  ];
  if (truePatterns.some((p) => p.test(text))) {
    return { verdict: "MOSTLY TRUE", score: 15 };
  }

  // Mostly false
  if (/mostly false|half true|half true/i.test(text)) {
    return { verdict: "MOSTLY FALSE", score: 80 };
  }

  return null;
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
      const msg =
        typeof err.response.data === "object" &&
        err.response.data !== null &&
        "error" in err.response.data
          ? String((err.response.data as { error?: string }).error)
          : JSON.stringify(err.response.data);
      throw new Error(`SerpAPI: ${err.response.status} ${msg}`);
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
      const msg =
        typeof err.response.data === "object" &&
        err.response.data !== null &&
        "error" in err.response.data
          ? String((err.response.data as { error?: string }).error)
          : JSON.stringify(err.response.data);
      throw new Error(`SerpAPI News: ${err.response.status} ${msg}`);
    }
    throw err;
  }
}

function toPageResult(
  r: SerpOrganicResult | SerpNewsResult,
  source: string
): PageResultItem {
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
    const body = (await request.json()) as Partial<AnalyzeUrlBody>;
    let url = body?.url?.trim();

    if (!url) {
      return NextResponse.json({ error: "Missing url" }, { status: 400 });
    }

    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      url = "https://" + url;
    }

    try {
      new URL(url);
    } catch {
      return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
    }

    const apiKey = process.env.SERPAPI_KEY?.trim();
    if (!apiKey) {
      return NextResponse.json(
        { error: "SERPAPI_KEY not configured" },
        { status: 500 }
      );
    }

    // —— Step A: Scrape the URL ——
    const scraped = await scrapeUrl(url);

    if (!scraped.body && !scraped.title && !scraped.description) {
      const isXUrl = /(?:^https?:\/\/)(?:x\.com|twitter\.com)\//i.test(url);
      return NextResponse.json(
        {
          error: isXUrl
            ? "Could not access this X/Twitter post. X often blocks automated requests. Try copying the tweet text and pasting it into the Text fact-check (/test-text) instead."
            : "Could not extract content from this URL. The page may require JavaScript or block scrapers.",
        },
        { status: 400 }
      );
    }

    // Detect X error page that slipped through (e.g. oEmbed failed)
    const isXErrorContent =
      /(?:^https?:\/\/)(?:x\.com|twitter\.com)\//i.test(url) &&
      /something went wrong|privacy related extensions.*try again/i.test(
        `${scraped.body} ${scraped.description}`
      );
    if (isXErrorContent) {
      return NextResponse.json(
        {
          error:
            "Could not access this X/Twitter post. X often blocks automated requests. Try copying the tweet text and pasting it into the Text fact-check (/test-text) instead.",
        },
        { status: 400 }
      );
    }

    // Build search query — for tweets, use the claim text (body/description), not "Tweet by X"
    const isTweet = /^Tweet by /i.test(scraped.title) || scraped.body?.includes("pic.twitter.com");
    let searchQuery = isTweet
      ? (scraped.body || scraped.description || scraped.title).slice(0, 200)
      : scraped.title || scraped.description?.slice(0, 100) || scraped.body?.slice(0, 150) || url;
    searchQuery = searchQuery.replace(/https?:\/\/\S+|pic\.twitter\.com\/\S+/g, "").trim() || searchQuery;

    // —— Step B: Search web + news + Politifact + Snopes ——
    const [generalRes, newsRes, politifactRes, snopesRes] = await Promise.all([
      runSerpSearch(apiKey, searchQuery, { as_qdr: "d2" }),
      runSerpNewsSearch(apiKey, searchQuery),
      runSerpSearch(apiKey, `site:politifact.com ${searchQuery}`),
      runSerpSearch(apiKey, `site:snopes.com ${searchQuery}`),
    ]);

    const pageResults: PageResultItem[] = [
      ...generalRes.slice(0, 12).map((r) => toPageResult(r, "Web")),
      ...newsRes.slice(0, 10).map((r) => toPageResult(r, "News")),
      ...politifactRes.slice(0, 8).map((r) => toPageResult(r, "PolitiFact")),
      ...snopesRes.slice(0, 8).map((r) => toPageResult(r, "Snopes")),
    ];

    const seen = new Set<string>();
    const uniqueResults = pageResults.filter((p) => {
      if (!p.link || seen.has(p.link)) return false;
      seen.add(p.link);
      return true;
    });

    // —— Step C: Claude analysis ——
    const accessKeyId =
      process.env.AWS_BEDROCK_ACCESS_KEY_ID?.trim() ??
      process.env.AWS_ACCESS_KEY_ID?.trim();
    const secretAccessKey =
      process.env.AWS_BEDROCK_SECRET_ACCESS_KEY?.trim() ??
      process.env.AWS_BEDROCK_KEY?.trim();
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

    const userPrompt = `You are a fact-checking analyst. A user submitted a URL. We scraped the page content below.

SCRAPED PAGE (from ${url}):
Title: ${scraped.title || "(none)"}
Description: ${scraped.description || "(none)"}
Body (excerpt): ${scraped.body || "(none)"}

SEARCH RESULTS (Web, News, PolitiFact, Snopes — use these links for timeline):
${searchContextText || "No search results found."}

CRITICAL: If the scraped URL is from PolitiFact, Snopes, or another fact-checker (politifact.com, snopes.com, factcheck.org, etc.), the page ITSELF contains their verdict. The scraped content tells you what claim they evaluated and whether they rated it True, False, Mostly True, etc. USE THEIR VERDICT. Do NOT return UNVERIFIED when a fact-checker has already given a clear verdict. Example: if PolitiFact says "We rate this False" or the title/description says "That wasn't Liam... It wasn't Conejo Ramos", the verdict is FALSE (score 80-95).

RULES:
1. Fact-checker pages: Use the verdict stated in the scraped content. FALSE if they say False; TRUE if they say True; map their ratings to ours.
2. Other pages/tweets: Extract the main factual claims and verify against search results.
3. Widely-debunked conspiracy claims (e.g. "Epstein alive", "Epstein Israel/Tel Aviv", "faked death") have been fact-checked as FALSE by PolitiFact, Snopes, and major outlets. If the claim matches such patterns and search results or your knowledge indicate it is false, return FALSE (80-95), not UNVERIFIED.
4. TRUE/MOSTLY TRUE (5-30) if corroborated; FALSE/MOSTLY FALSE (70-100) if contradicted or debunked.
5. UNVERIFIED (50) only if: scraped content is empty/unclear, not a factual article, or no verdict/evidence available.
6. Always provide an explanation and timeline. Use links from search results for timeline nodes.

Verdict: TRUE/MOSTLY TRUE | FALSE/MOSTLY FALSE | UNVERIFIED.
Score 0-100: higher = more FALSE.

Return ONLY valid JSON, no markdown:
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
    let parsed: Partial<UrlAnalysisResult>;
    try {
      const envelope = JSON.parse(responseText) as {
        content?: { type?: string; text?: string }[];
      };
      const text =
        envelope?.content?.[0]?.type === "text" &&
        typeof envelope.content[0].text === "string"
          ? envelope.content[0].text
          : responseText;
      parsed = JSON.parse(text) as Partial<UrlAnalysisResult>;
    } catch {
      try {
        parsed = JSON.parse(responseText) as Partial<UrlAnalysisResult>;
      } catch {
        return NextResponse.json(
          {
            error: "Could not parse Bedrock response as JSON",
            raw: responseText.slice(0, 500),
          },
          { status: 500 }
        );
      }
    }

    const timelineRaw = (Array.isArray(parsed.timeline)
      ? parsed.timeline
      : []) as unknown[];
    const timelineNodes = timelineRaw
      .filter(
        (t): t is Record<string, unknown> =>
          t != null && typeof t === "object"
      )
      .map((t) => ({
        label: typeof t.label === "string" ? t.label : "Event",
        date: typeof t.date === "string" ? t.date : "N/A",
        description: typeof t.description === "string" ? t.description : "",
        link: typeof t.link === "string" ? t.link : "",
      }));

    // Override UNVERIFIED when we detect a fact-check verdict from PolitiFact/Snopes
    const detectedVerdict = detectFactCheckVerdict(url, scraped);
    let verdict = typeof parsed.verdict === "string" ? parsed.verdict : "UNVERIFIED";
    let score =
      typeof parsed.score === "number"
        ? Math.min(100, Math.max(0, parsed.score))
        : 50;
    let explanation = typeof parsed.explanation === "string" ? parsed.explanation : "";

    if (detectedVerdict && verdict.toUpperCase().includes("UNVERIFIED")) {
      verdict = detectedVerdict.verdict;
      score = detectedVerdict.score;
      if (!explanation) {
        explanation = `This page is from a fact-checker (PolitiFact/Snopes). The scraped content indicates the claim has been rated ${detectedVerdict.verdict}.`;
      }
    }

    const result: UrlAnalysisResult = {
      verdict,
      score,
      explanation,
      timeline: timelineNodes,
      pageResults: uniqueResults,
      scrapedContent: scraped,
    };

    return NextResponse.json(result);
  } catch (err) {
    console.error("Analyze-URL API error:", err);
    const message = err instanceof Error ? err.message : "Analysis failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
