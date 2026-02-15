import { NextRequest, NextResponse } from "next/server";
import axios from "axios";
import * as cheerio from "cheerio";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { getBackboardSecondOpinion } from "@/lib/backboard";
import { filterRelevantFactChecks, getGeminiSecondOpinion } from "@/lib/gemini";

const SERPAPI_BASE = "https://serpapi.com/search.json";
const FACT_CHECK_API = "https://factchecktools.googleapis.com/v1alpha1/claims:search";
const BEDROCK_MODEL_ID = "global.anthropic.claude-sonnet-4-20250514-v1:0";

type FactCheckResult = {
  claim: string;
  rating: string;
  publisher: string;
  url: string;
  title?: string;
};

async function fetchFactChecks(apiKey: string, query: string): Promise<FactCheckResult[]> {
  try {
    const res = await axios.get<{
      claims?: Array<{
        text?: string;
        claimReview?: Array<{
          publisher?: { name?: string };
          url?: string;
          title?: string;
          textualRating?: string;
        }>;
      }>;
    }>(FACT_CHECK_API, { params: { key: apiKey, query }, timeout: 15000 });
    const results: FactCheckResult[] = [];
    for (const c of res.data?.claims ?? []) {
      for (const r of c.claimReview ?? []) {
        if (r.url && r.textualRating) {
          results.push({
            claim: c.text ?? "",
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

export type AnalyzeUrlBody = {
  url: string;
  /** Optional claim or context from the user (e.g. when URL + text is pasted). */
  claim?: string;
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

export type UrlAnalysisResult = {
  verdict: string;
  score: number;
  explanation: string;
  timeline: TimelineNode[];
  pageResults: PageResultItem[];
  scrapedContent?: { title: string; description: string; body: string; imageUrls?: string[] };
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

type ScrapedContent = { title: string; description: string; body: string; imageUrls: string[] };

/** Try X/Twitter oEmbed (more reliable than direct scrape; X blocks scrapers). */
async function fetchXViaOembed(tweetUrl: string): Promise<ScrapedContent | null> {
  try {
    const cleanUrl = tweetUrl.replace(/\?.*$/, "");
    // hide_media=false (default) includes images in the embed HTML
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
    // Extract image URLs from img tags in the oEmbed HTML
    const imageUrls: string[] = [];
    $("img").each((_, el) => {
      const src = $(el).attr("src");
      if (src && /^https?:\/\//i.test(src)) imageUrls.push(src);
    });
    return {
      title: `Tweet by ${res.data?.author_name ?? "X user"}`,
      description: text.slice(0, 300),
      body: text,
      imageUrls,
    };
  } catch {
    return null;
  }
}

async function scrapeUrl(url: string): Promise<ScrapedContent> {
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

  // Extract image URLs from meta tags (og:image, twitter:image)
  const imageUrls: string[] = [];
  const ogImage = $('meta[property="og:image"]').attr("content");
  const twitterImage = $('meta[name="twitter:image"]').attr("content");
  if (ogImage && /^https?:\/\//i.test(ogImage)) imageUrls.push(ogImage);
  if (twitterImage && /^https?:\/\//i.test(twitterImage) && !imageUrls.includes(twitterImage)) {
    imageUrls.push(twitterImage);
  }

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

  // X/Twitter: try oEmbed first (more reliable; X blocks direct scrapers)
  const isXUrl = /(?:^https?:\/\/)(?:x\.com|twitter\.com)\//i.test(url);
  if (isXUrl) {
    const oembed = await fetchXViaOembed(url);
    if (oembed) {
      // Merge og:image from direct fetch if oEmbed didn't return images
      if ((oembed.imageUrls?.length ?? 0) === 0 && imageUrls.length > 0) {
        oembed.imageUrls = imageUrls;
      }
      return oembed;
    }
    // oEmbed failed; use direct scrape (may still have og meta tags)
  }

  return {
    title: title.trim().slice(0, 500),
    description: description.trim().slice(0, 1000),
    body,
    imageUrls,
  };
}

/** When URL is from a fact-checker, try to extract verdict from scraped content. */
function detectFactCheckVerdict(
  url: string,
  scraped: { title: string; description: string; body: string }
): { verdict: string; score: number } | null {
  if (!/politifact\.com|snopes\.com|factcheck\.org|factcheck\.afp\.com/i.test(url)) return null;

  const text = `${scraped.title} ${scraped.description} ${scraped.body}`.toLowerCase();

  // PolitiFact/Snopes FALSE indicators (debunking)
  const falsePatterns = [
    /(?:wasn't|was not|is not|were not|didn't|did not)\s+(?:liam|he|she|it|they|the|conejo|ramos)/i,
    /we rate .+ false/i,
    /rated false|rates? (?:this|it) false/i,
    /pants on fire|pants-fire/i,
    /\bfalse\b.*(?:politifact|snopes|fact.?check|afp)/i,
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
    /\btrue\b.*(?:politifact|snopes|afp)/i,
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

/** Extract verdict from fact-check result snippets. */
/** Fetch Google Lens About This Image for an image URL. */
async function fetchAboutThisImage(
  apiKey: string,
  imageUrl: string
): Promise<{ headerTitle: string | null; pageResults: PageResultItem[] } | null> {
  try {
    const params = new URLSearchParams({
      engine: "google_lens",
      url: imageUrl,
      api_key: apiKey,
      type: "about_this_image",
    });
    const res = await axios.get<Record<string, unknown>>(
      `${SERPAPI_BASE}?${params.toString()}`,
      { timeout: 30000 }
    );
    const ati = res.data?.about_this_image as Record<string, unknown> | undefined;
    if (!ati) return null;
    const header = ati.header as Record<string, unknown> | undefined;
    const headerTitle = typeof header?.title === "string" ? header.title : null;
    const sections = (ati.sections as unknown[] | undefined) ?? [];
    const pageResults: PageResultItem[] = [];
    for (const sec of sections) {
      const section = sec as Record<string, unknown>;
      const results = (section.page_results as unknown[] | undefined) ?? [];
      for (const r of results) {
        const row = r as Record<string, unknown>;
        pageResults.push({
          date: typeof row.date === "string" ? row.date : "N/A",
          link: typeof row.link === "string" ? row.link : "",
          title: typeof row.title === "string" ? row.title : "Unknown",
          snippet: typeof row.snippet === "string" ? row.snippet : null,
          source: "About This Image",
        });
      }
    }
    return pageResults.length > 0 ? { headerTitle, pageResults } : null;
  } catch {
    return null;
  }
}

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
  const falseMatch = /(?:rated?|rate|rates)\s+(?:as\s+)?(?:false|pants\s*[- ]?on\s*fire|full\s*flop)|(?:false|pants\s*on\s*fire|debunked|fake|hoax|misleading)/.test(combined) ||
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
    const body = (await request.json()) as Partial<AnalyzeUrlBody>;
    let url = body?.url?.trim();
    const userClaim = body?.claim?.trim();

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

    // Build search query — for image tweets, use title + description as claim; else body/description
    const isTweet = /^Tweet by /i.test(scraped.title) || scraped.body?.includes("pic.twitter.com");
    const hasImage = (scraped.imageUrls?.length ?? 0) > 0;
    const isImageTweet = isTweet && hasImage;
    let searchQuery = isImageTweet
      ? `${scraped.title} ${scraped.description}`.trim().slice(0, 200) || scraped.body?.slice(0, 150)
      : isTweet
        ? (scraped.body || scraped.description || scraped.title).slice(0, 200)
        : scraped.title || scraped.description?.slice(0, 100) || scraped.body?.slice(0, 150) || url;
    searchQuery = searchQuery.replace(/https?:\/\/\S+|pic\.twitter\.com\/\S+/g, "").trim() || searchQuery;
    if (userClaim) {
      searchQuery = `${searchQuery} ${userClaim}`.trim().slice(0, 250);
    }

    // —— Step B1: If tweet has image, run Google Lens About This Image ——
    let aboutThisImageResults: PageResultItem[] = [];
    let aboutThisImageHeader: string | null = null;
    if (isTweet && hasImage && scraped.imageUrls && scraped.imageUrls[0]) {
      const ati = await fetchAboutThisImage(apiKey, scraped.imageUrls[0]);
      if (ati) {
        aboutThisImageHeader = ati.headerTitle;
        aboutThisImageResults = ati.pageResults;
      }
    }

    // —— Step B2: Google Fact Check API + SerpAPI ——
    const factCheckKey = process.env.GOOGLE_FACT_CHECK_API_KEY?.trim();
    const shortQuery = searchQuery.length > 80 ? searchQuery.slice(0, 80) : searchQuery;
    const [factCheckRes1, factCheckRes2, generalRes, newsRes, factCheckSearchRes, politifactRes, snopesRes, factcheckOrgRes, afpRes] =
      await Promise.all([
        factCheckKey ? fetchFactChecks(factCheckKey, searchQuery) : Promise.resolve([] as FactCheckResult[]),
        factCheckKey && searchQuery !== shortQuery ? fetchFactChecks(factCheckKey, shortQuery) : Promise.resolve([] as FactCheckResult[]),
        runSerpSearch(apiKey, searchQuery, { as_qdr: "y1" }), // 1 year — older fact-checks matter
        runSerpNewsSearch(apiKey, searchQuery),
        runSerpSearch(apiKey, `${searchQuery} fact check`),
        runSerpSearch(apiKey, `site:politifact.com ${searchQuery}`),
        runSerpSearch(apiKey, `site:snopes.com ${searchQuery}`),
        runSerpSearch(apiKey, `site:factcheck.org ${searchQuery}`),
        runSerpSearch(apiKey, `site:factcheck.afp.com ${searchQuery}`),
      ]);

    const factCheckRes: FactCheckResult[] = [...factCheckRes1];
    for (const f of factCheckRes2) {
      if (!factCheckRes.some((e) => e.url === f.url)) factCheckRes.push(f);
    }

    const pageResults: PageResultItem[] = [
      ...aboutThisImageResults.slice(0, 12),
      ...generalRes.slice(0, 12).map((r) => toPageResult(r, "Web")),
      ...newsRes.slice(0, 10).map((r) => toPageResult(r, "News")),
      ...factCheckSearchRes.slice(0, 8).map((r) => toPageResult(r, "FactCheck")),
      ...politifactRes.slice(0, 8).map((r) => toPageResult(r, "PolitiFact")),
      ...snopesRes.slice(0, 8).map((r) => toPageResult(r, "Snopes")),
      ...factcheckOrgRes.slice(0, 8).map((r) => toPageResult(r, "FactCheck.org")),
      ...afpRes.slice(0, 8).map((r) => toPageResult(r, "AFP")),
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

    const factCheckContext =
      factCheckRes.length > 0
        ? `\n\nGOOGLE FACT CHECK API (authoritative — USE THESE):\n` +
          factCheckRes
            .slice(0, 10)
            .map((f) => `- ${f.publisher}: ${f.rating} | ${f.url}`)
            .join("\n")
        : "";

    const imageContext =
      hasImage && aboutThisImageResults.length > 0
        ? `\n\nIMAGE IN POST (Google Lens About This Image): The tweet/page contains an image. We ran reverse image search. Use this to verify if the image matches the claim/caption.
${aboutThisImageHeader ? `Header: ${aboutThisImageHeader}` : ""}
Pages where this image appears (from About This Image):\n` +
          aboutThisImageResults
            .slice(0, 10)
            .map((p) => `- ${p.title} | ${p.date} | ${p.snippet ?? ""} | ${p.link}`)
            .join("\n")
        : hasImage && scraped.imageUrls?.[0]
          ? `\n\nIMAGE IN POST: The tweet contains an image (${scraped.imageUrls[0]}). No About This Image data was found — use search results to verify the claim.`
          : "";

    const claimNote = userClaim
      ? ` The user also provided this specific claim/context to verify: "${userClaim}"`
      : "";
    const userPrompt = `You are a dispassionate fact-checking analyst. Your goal is not to balance opinions, but to verify the chronological origin of the media. Prioritize primary source dates over commentary. Use precise, clinical language. Avoid emotive adjectives. Give ACCURATE verdicts. Avoid UNVERIFIED when evidence exists. A user submitted a URL. We scraped the page content below.${claimNote}${isImageTweet ? " This is an image tweet: use the title/caption as the claim and verify against the image's About This Image context and search results." : ""}

SCRAPED PAGE (from ${url}):
Title: ${scraped.title || "(none)"}
Description: ${scraped.description || "(none)"}
Body (excerpt): ${scraped.body || "(none)"}
${hasImage ? `Image URL(s): ${scraped.imageUrls?.slice(0, 3).join(", ") || "(extracted)"}` : ""}
${imageContext}

SEARCH RESULTS:
${searchContextText || "No search results found."}
${factCheckContext}

Analyze the scraped content and search results above. Base your verdict on the evidence:
- If Google Fact Check API or PolitiFact/Snopes returned ratings, weigh them heavily.
- Compare the article's claims against Web, News, and fact-check sources. Do sources corroborate, contradict, or leave claims unaddressed?
- Evaluate each case on its merits. Do not apply rigid rules—reason from the evidence provided.
- UNVERIFIED only when there is genuinely insufficient evidence to reach a conclusion.
For the timeline: use the exact "date" from the SEARCH RESULTS or IMAGE IN POST lines above when a node corresponds to that source. Every timeline date must include the year (e.g. "Jan 15, 2024").

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
      .map((t) => {
        const dateStr = typeof t.date === "string" ? t.date : "N/A";
        return {
          label: typeof t.label === "string" ? t.label : "Event",
          date: formatTimelineDate(dateStr),
          description: typeof t.description === "string" ? t.description : "",
          link: typeof t.link === "string" ? t.link : "",
        };
      });

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

    // Override: Google Fact Check API has verdicts but Claude returned UNVERIFIED
    if (verdict.toUpperCase().includes("UNVERIFIED") && factCheckRes.length > 0) {
      const ratings = factCheckRes.flatMap((f) =>
        (f.rating || "").toLowerCase().split(/[\s,]+/)
      );
      const falseIndicators = ["false", "pants on fire", "pants-on-fire", "full flop", "lie", "debunk", "misleading"];
      const trueIndicators = ["true", "correct", "accurate", "mostly true"];
      const hasFalse = ratings.some((r) => falseIndicators.some((i) => r.includes(i)));
      const hasTrue = ratings.some((r) => trueIndicators.some((i) => r.includes(i)));
      if (hasFalse && !hasTrue) {
        verdict = "FALSE";
        score = Math.max(score, 85);
        explanation = `Fact-check sources rate this as false. ${explanation}`;
      } else if (hasTrue && !hasFalse) {
        verdict = "TRUE";
        score = Math.min(score, 25);
        explanation = `Fact-check sources support this claim. ${explanation}`;
      }
    }

    // Override: PolitiFact/Snopes/FactCheck snippets contain clear verdicts
    if (verdict.toUpperCase().includes("UNVERIFIED")) {
      const snippetVerdict = verdictFromSnippets(uniqueResults, ["PolitiFact", "Snopes", "FactCheck", "FactCheck.org", "AFP"]);
      if (snippetVerdict) {
        verdict = snippetVerdict.verdict;
        score = snippetVerdict.score;
        if (!explanation) {
          explanation = `Fact-check search results indicate this has been rated ${snippetVerdict.verdict}.`;
        }
      }
    }

    // Backboard + Gemini second opinion: only when still UNVERIFIED (parallel for speed)
    if (verdict.toUpperCase().includes("UNVERIFIED")) {
      const urlClaim = userClaim || `${scraped.title || ""} ${scraped.description || ""}`.trim().slice(0, 300) || url;
      const contextSummary = [searchContextText, factCheckContext].filter(Boolean).join("\n") || "No search results.";
      const [backboard, gemini] = await Promise.all([
        getBackboardSecondOpinion(urlClaim, contextSummary, process.env.BACKBOARD_API_KEY?.trim()),
        getGeminiSecondOpinion(urlClaim, contextSummary, process.env.GEMINI_API_KEY?.trim()),
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

    // Filter fact-check sources to only those relevant to the topic (Gemini)
    const topic = userClaim || `${scraped.title || ""} ${scraped.description || ""}`.trim().slice(0, 300) || url;
    const factCheckSourceNames = ["PolitiFact", "Snopes", "FactCheck", "FactCheck.org", "AFP"];
    const nonFactCheck = uniqueResults.filter((p) => !factCheckSourceNames.includes(p.source));
    const factChecks = uniqueResults.filter((p) => factCheckSourceNames.includes(p.source));
    const filteredFactChecks = await filterRelevantFactChecks(
      topic,
      factChecks,
      process.env.GEMINI_API_KEY?.trim()
    );
    const pageResultsFiltered = [...nonFactCheck, ...filteredFactChecks];

    const result: UrlAnalysisResult = {
      verdict,
      score,
      explanation,
      timeline: timelineNodes,
      pageResults: pageResultsFiltered,
      scrapedContent: {
        title: scraped.title,
        description: scraped.description,
        body: scraped.body,
        ...(scraped.imageUrls?.length ? { imageUrls: scraped.imageUrls } : {}),
      },
    };

    return NextResponse.json(result);
  } catch (err) {
    console.error("Analyze-URL API error:", err);
    const message = err instanceof Error ? err.message : "Analysis failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
