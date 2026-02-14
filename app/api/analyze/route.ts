import { NextRequest, NextResponse } from "next/server";
import axios from "axios";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

const SERPAPI_BASE = "https://serpapi.com/search";
const BEDROCK_MODEL_ID = "anthropic.claude-3-5-sonnet-20241022-v2:0";

export type AnalyzeBody = {
  imageUrl: string;
  userClaim: string;
};

export type VisualMatch = {
  source: string;
  title: string;
  date: string;
};

export type AnalysisResult = {
  verdict: string;
  score: number;
  explanation: string;
  timeline: Array<{ year: string; event: string }>;
  imageHistory?: {
    knowledgeGraphTitle: string | null;
    visualMatches: VisualMatch[];
  };
};

function parseSerpLensResponse(data: Record<string, unknown>): {
  knowledgeGraphTitle: string | null;
  visualMatches: VisualMatch[];
} {
  const kg = data.knowledge_graph as Record<string, unknown> | undefined;
  const title =
    typeof kg?.title === "string" ? kg.title : null;

  const rawMatches = (data.visual_matches as unknown[] | undefined) ?? [];
  const visualMatches: VisualMatch[] = rawMatches.slice(0, 5).map((m: unknown) => {
    const row = m as Record<string, unknown>;
    return {
      source: typeof row.source === "string" ? row.source : "Unknown",
      title: typeof row.title === "string" ? row.title : "Unknown",
      date: typeof (row as { date?: string }).date === "string" ? (row as { date: string }).date : "N/A",
    };
  });

  return { knowledgeGraphTitle: title, visualMatches };
}

function buildNoDigitalFootprintResult(): AnalysisResult {
  return {
    verdict: "No Digital Footprint",
    score: 0,
    explanation:
      "No visual matches were found for this image. The image may be rare, heavily edited, or not widely indexed.",
    timeline: [],
    imageHistory: {
      knowledgeGraphTitle: null,
      visualMatches: [],
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

    const apiKey = process.env.SERPAPI_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "SERPAPI_KEY not configured" },
        { status: 500 }
      );
    }

    // —— Step A: Trace via Google Lens (SerpApi) ——
    const serpParams = new URLSearchParams({
      engine: "google_lens",
      url: imageUrl,
      api_key: apiKey,
      type: "all",
    });
    const serpRes = await axios.get<Record<string, unknown>>(
      `${SERPAPI_BASE}?${serpParams.toString()}`,
      { timeout: 30000 }
    );
    const serpData = serpRes.data;

    const searchMeta = serpData.search_metadata as Record<string, unknown> | undefined;
    const status = searchMeta?.status;
    if (status === "Error" || (typeof status === "string" && status.toLowerCase() === "error")) {
      return NextResponse.json(buildNoDigitalFootprintResult());
    }

    // —— Step B: Parse ——
    const { knowledgeGraphTitle, visualMatches } = parseSerpLensResponse(serpData);

    // 0 matches → No Digital Footprint (skip Bedrock)
    if (visualMatches.length === 0) {
      return NextResponse.json(buildNoDigitalFootprintResult());
    }

    const imageHistory = {
      knowledgeGraphTitle,
      visualMatches,
    };

    // —— Step C: Deduce via AWS Bedrock (Claude 3.5 Sonnet) ——
    const region = process.env.AWS_REGION ?? "us-east-1";
    const client = new BedrockRuntimeClient({ region });

    const imageHistoryText = [
      knowledgeGraphTitle ? `Identified subject: ${knowledgeGraphTitle}` : "",
      "Visual matches (source, title, date):",
      ...visualMatches.map(
        (m) => `- ${m.source} | ${m.title} | ${m.date}`
      ),
    ]
      .filter(Boolean)
      .join("\n");

    const userPrompt = `You are a context forensics analyst. Compare the User Claim vs. the Image History below. Determine if the image's context has been hijacked (e.g. misattributed event, wrong place/time, misleading caption).

User Claim: ${userClaim}

Image History:
${imageHistoryText}

Return ONLY valid JSON with no markdown, no code fences, no explanation outside the JSON. Use this exact structure:
{"verdict":"string (e.g. CONTEXT HIJACKED or CONTEXT ACCURATE)","score":number 0-100 (higher = more likely context is wrong/hijacked),"explanation":"string","timeline":[{"year":"string","event":"string"}]}`;

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

    const result: AnalysisResult = {
      verdict: typeof parsed.verdict === "string" ? parsed.verdict : "Unknown",
      score: typeof parsed.score === "number" ? Math.min(100, Math.max(0, parsed.score)) : 0,
      explanation: typeof parsed.explanation === "string" ? parsed.explanation : "",
      timeline: Array.isArray(parsed.timeline)
        ? parsed.timeline.filter(
            (t): t is { year: string; event: string } =>
              t != null && typeof (t as { year?: string }).year === "string" && typeof (t as { event?: string }).event === "string"
          )
        : [],
      imageHistory,
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
