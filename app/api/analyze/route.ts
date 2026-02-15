import { NextRequest, NextResponse } from "next/server";
import axios from "axios";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

const SERPAPI_BASE = "https://serpapi.com/search.json";
// Use inference profile ID for on-demand; foundation model ID alone is not supported.
// Claude Sonnet 4 — callable from us-east-1, us-east-2, us-west-2, ap-northeast-1, eu-west-1.
const BEDROCK_MODEL_ID = "global.anthropic.claude-sonnet-4-20250514-v1:0";

export type AnalyzeBody = {
  imageUrl: string;
  userClaim: string;
};

export type VisualMatch = {
  source: string;
  title: string;
  date: string;
};

/** One page from About This Image sections (date, link, title, snippet for timeline). */
export type PageResultItem = {
  date: string;
  link: string;
  title: string;
  snippet: string | null;
};

/** About This Image: header blurb + page_results for timeline bento. */
export type AboutThisImageData = {
  headerTitle: string | null;
  headerImage: string | null;
  pageResults: PageResultItem[];
};

/** One timeline node built by Claude from the image story (variable count). */
export type TimelineNode = {
  label: string;
  date: string;
  description: string;
  link: string;
};

export type AnalysisResult = {
  verdict: string;
  score: number;
  explanation: string;
  /** Variable-length timeline (2 = creation + current, 3 = original + doctored + current, etc.). */
  timeline: TimelineNode[];
  imageHistory?: {
    knowledgeGraphTitle: string | null;
    visualMatches: VisualMatch[];
  };
  /** From SerpApi type=about_this_image: header + page_results for bento UI. */
  aboutThisImage?: AboutThisImageData;
};

function parseAboutThisImageResponse(data: Record<string, unknown>): AboutThisImageData | null {
  const ati = data.about_this_image as Record<string, unknown> | undefined;
  if (!ati) return null;

  const header = ati.header as Record<string, unknown> | undefined;
  const headerTitle =
    typeof header?.title === "string" ? header.title : null;
  const headerImage =
    typeof header?.image === "string" ? header.image : null;

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
      });
    }
  }

  return { headerTitle, headerImage, pageResults };
}

function buildNoDigitalFootprintResult(): AnalysisResult {
  return {
    verdict: "No Digital Footprint",
    score: 0,
    explanation:
      "No About This Image data was found for this image. The image may be rare, heavily edited, or not widely indexed.",
    timeline: [],
    imageHistory: {
      knowledgeGraphTitle: null,
      visualMatches: [],
    },
    aboutThisImage: {
      headerTitle: null,
      headerImage: null,
      pageResults: [],
    },
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Partial<AnalyzeBody>;
    const imageUrl = body?.imageUrl?.trim();
    const userClaim = body?.userClaim?.trim();

    if (!imageUrl || !userClaim) {
      return NextResponse.json(
        { error: "Missing imageUrl or userClaim" },
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

    // —— Step A: Trace via Google Lens About This Image (SerpApi) ——
    const serpParams = new URLSearchParams({
      engine: "google_lens",
      url: imageUrl,
      api_key: apiKey,
      type: "about_this_image",
    });
    let serpData: Record<string, unknown>;
    try {
      const serpRes = await axios.get<Record<string, unknown>>(
        `${SERPAPI_BASE}?${serpParams.toString()}`,
        { timeout: 30000 }
      );
      serpData = serpRes.data;
    } catch (serpErr: unknown) {
      if (axios.isAxiosError(serpErr) && serpErr.response?.status === 401) {
        const serpMessage =
          (serpErr.response?.data as { error?: string } | undefined)?.error ??
          "No valid API key provided.";
        return NextResponse.json(
          {
            error: "SerpApi authentication failed (401).",
            detail: serpMessage,
            hint: "Confirm SERPAPI_KEY in .env.local matches the key at https://serpapi.com/manage-api-key (no quotes, no trailing space). Restart the dev server after changing .env.local.",
          },
          { status: 500 }
        );
      }
      throw serpErr;
    }

    const searchMeta = serpData.search_metadata as Record<string, unknown> | undefined;
    const status = searchMeta?.status;
    if (status === "Error" || (typeof status === "string" && status.toLowerCase() === "error")) {
      return NextResponse.json(buildNoDigitalFootprintResult());
    }

    // —— Step B: Parse About This Image (header + page_results) ——
    const aboutThisImage = parseAboutThisImageResponse(serpData);
    const hasUsableContext =
      aboutThisImage &&
      (aboutThisImage.headerTitle ||
        aboutThisImage.headerImage ||
        aboutThisImage.pageResults.length > 0);
    if (!hasUsableContext) {
      return NextResponse.json({
        ...buildNoDigitalFootprintResult(),
        aboutThisImage: aboutThisImage ?? { headerTitle: null, headerImage: null, pageResults: [] },
      });
    }

    const hostname = (url: string) => {
      try {
        return new URL(url).hostname;
      } catch {
        return "Unknown";
      }
    };
    const pageResultsList = aboutThisImage!.pageResults ?? [];
    const imageHistory = {
      knowledgeGraphTitle: aboutThisImage!.headerTitle,
      visualMatches: pageResultsList.slice(0, 15).map((p) => ({
        source: hostname(p.link),
        title: p.title,
        date: p.date,
      })),
    };

    // —— Step C: Deduce via AWS Bedrock (Claude 3.5 Sonnet) ——
    // AWS IAM requires two separate values: Access Key ID (e.g. AKIA...) and Secret Access Key.
    const accessKeyId = process.env.AWS_BEDROCK_ACCESS_KEY_ID?.trim() ?? process.env.AWS_ACCESS_KEY_ID?.trim();
    const secretAccessKey = process.env.AWS_BEDROCK_SECRET_ACCESS_KEY?.trim() ?? process.env.AWS_BEDROCK_KEY?.trim();
    if (!accessKeyId || !secretAccessKey) {
      return NextResponse.json(
        {
          error: "AWS Bedrock credentials not configured.",
          hint: "Set AWS_BEDROCK_ACCESS_KEY_ID and AWS_BEDROCK_SECRET_ACCESS_KEY in .env.local (or AWS_ACCESS_KEY_ID and AWS_BEDROCK_KEY for the secret). Get both from IAM → Security credentials → Access keys.",
        },
        { status: 500 }
      );
    }
    const region = process.env.AWS_REGION ?? "us-east-1";
    const client = new BedrockRuntimeClient({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });

    const imageHistoryText = [
      aboutThisImage!.headerTitle ? `About this image: ${aboutThisImage!.headerTitle}` : "",
      aboutThisImage!.headerImage ? `Header image URL: ${aboutThisImage!.headerImage}` : "",
      pageResultsList.length > 0
        ? "Found on these pages (use these exact link URLs when you assign a link to a timeline node):"
        : "No specific pages were found; use the header context above and the user claim to assess context accuracy.",
      ...pageResultsList.slice(0, 20).map(
        (p) => `- date: ${p.date} | title: ${p.title} | snippet: ${p.snippet ?? "(none)"} | link: ${p.link}`
      ),
    ]
      .filter(Boolean)
      .join("\n");

    const userPrompt = `You are a context forensics analyst. Compare the User Claim vs. the Image History below. Determine if the image's context has been hijacked (e.g. misattributed event, wrong place/time, misleading caption, or doctored image).

User Claim: ${userClaim}

Image History:
${imageHistoryText}

Build a timeline that tells the image's story. Use as many nodes as the story needs (not a fixed number):
- Simple case: 2 nodes (earliest/first use, current use).
- If the image was altered/doctored: 3+ nodes (e.g. original image → doctored version → current context).
- More nodes if there are other distinct moments (e.g. first viral use, then alteration, then current).
When page links are listed above, use a "link" URL from that list for each node; when no pages were found, use "" for link.
Verdict: TRUE (context accurate) | FALSE (context hijacked/wrong) | UNVERIFIED (cannot determine).
Score 0-100: higher = more FALSE.

Return ONLY valid JSON with no markdown, no code fences. Use this exact structure:
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
    let parsed: Partial<AnalysisResult>;
    try {
      const envelope = JSON.parse(responseText) as { content?: { type?: string; text?: string }[] };
      const text =
        envelope?.content?.[0]?.type === "text" && typeof envelope.content[0].text === "string"
          ? envelope.content[0].text
          : responseText;
      parsed = JSON.parse(text) as Partial<AnalysisResult>;
    } catch {
      try {
        parsed = JSON.parse(responseText) as Partial<AnalysisResult>;
      } catch {
        return NextResponse.json(
          { error: "Could not parse Bedrock response as JSON", raw: responseText.slice(0, 500) },
          { status: 500 }
        );
      }
    }

    const timelineNodes: TimelineNode[] = Array.isArray(parsed.timeline)
      ? parsed.timeline
          .filter((t) => t != null && typeof t === "object")
          .map((t) => {
            const o = t as Record<string, unknown>;
            return {
              label: typeof o.label === "string" ? o.label : "Event",
              date: typeof o.date === "string" ? o.date : "N/A",
              description: typeof o.description === "string" ? o.description : "",
              link: typeof o.link === "string" ? o.link : "",
            };
          })
      : [];

    const result: AnalysisResult = {
      verdict: typeof parsed.verdict === "string" ? parsed.verdict : "Unknown",
      score: typeof parsed.score === "number" ? Math.min(100, Math.max(0, parsed.score)) : 0,
      explanation: typeof parsed.explanation === "string" ? parsed.explanation : "",
      timeline: timelineNodes,
      imageHistory,
      aboutThisImage,
    };

    return NextResponse.json(result);
  } catch (err) {
    console.error("Analyze API error:", err);
    const message = err instanceof Error ? err.message : "Analysis failed";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
