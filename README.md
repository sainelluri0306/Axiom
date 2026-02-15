# Paper Trails

**Paper Trails** is a forensic intelligence engine designed to combat the **context collapse** of the modern internet. In an era where AI detectors rely on opaque, error-prone probability scores to flag misinformation, Paper Trails operates on a singular, irrefutable axiom:

> **Truth has a timeline.**

Instead of analyzing pixels for glitches, we trace the **history** of digital media to reveal its original context. By combining reverse-image forensics with semantic reasoning, and cross-verification with reputable sources, Paper Trails automatically generates an **evidence board** that exposes when a real image is being hijacked for a false narrative or when a synthetic image has no digital footprint at all. We don’t ask the user to trust a “Fake” label; we give them the historical proof to see the lie for themselves.

This is not just a fact-checker. It is a **paper trail of the internet**.

---

## Why Multiple Services = Total Fact-Checking Confidence

Single-model or single-API systems are brittle: one provider’s blind spot or bias becomes yours. Paper Trails is built on **deliberate redundancy and specialization** so that no single service holds a veto on the truth.

| Layer | Role | Why it matters |
|-------|------|-----------------|
| **SerpAPI (Google Lens)** | Reverse-image search, “About This Image,” web/news/fact-check SERP | Provides the **chronological footprint** of an image or claim—where and when it appeared. No LLM can invent this; it comes from the index. |
| **Google Fact Check API** | Structured verdicts from PolitiFact, Snopes, AFP, etc. | **Authoritative** ratings. When this API returns a result, we override UNVERIFIED and surface the publisher’s verdict so we don’t second-guess professional fact-checkers. |
| **AWS Bedrock (Claude Sonnet 4)** | Primary reasoning: timeline synthesis, verdict, explanation | **Semantic reasoning** over the evidence: did the image’s context get hijacked? Is the claim supported by the timeline? Dispassionate, chronology-first analyst persona. |
| **Gemini (Google)** | Second opinion when Bedrock returns UNVERIFIED; fact-check relevance filter | **Cross-vendor check.** When the primary model is uncertain, a different model (Gemini) gets the same evidence and can break the tie. Also filters fact-check hits to the claim so we don’t mix topics. |
| **Backboard (GPT-4o-mini)** | Second opinion when Bedrock returns UNVERIFIED | Another **independent model** on borderline cases. Parallel with Gemini so we don’t add latency when the primary verdict is already confident. |
| **Vercel Blob** | Temporary public URL for pasted/uploaded images | SerpAPI and Google Lens need a **stable, fetchable URL**. We host the image briefly, run the pipeline, then delete the blob so the image isn’t stored. |

Result: **Evidence comes from the web and fact-check APIs; reasoning and narrative come from LLMs; uncertain cases get a second (and optionally third) opinion from different providers.** No single API can hide or distort the full picture.

---

## Tech Stack

| Category | Technology |
|----------|------------|
| **Framework** | Next.js 16 (App Router) |
| **Language** | TypeScript |
| **Styling** | Tailwind CSS |
| **Fonts** | Special Elite (display), Inter, Jost (Next.js Google Fonts) |
| **Image forensics & search** | SerpAPI (Google Lens “About This Image,” Google Search, Google News, site-specific fact-check searches) |
| **Fact-check data** | Google Fact Check Tools API (Claims: search) |
| **Primary reasoning** | AWS Bedrock — Claude Sonnet 4 |
| **Second opinion** | Google Gemini 1.5 Flash, Backboard (GPT-4o-mini) |
| **Temporary image hosting** | Vercel Blob (for paste/upload so SerpAPI can fetch the image) |
| **Scraping** | Axios + Cheerio (URL body extraction for articles/tweets) |
| **Storage** | None persistent; Blob objects are deleted after analysis |

---

## Architecture

### Three entry points, one evidence-board output

The app accepts **image**, **URL**, or **text** (claim). Each path gathers evidence and then reasons over it; the UI unifies the result into a single **evidence board**: timeline, verdict, score, explanation, relevant sources, and cross-examination (fact-check) links.

---

### 1. Image analysis (`/api/analyze`)

**Input:** Image (public URL or pasted/uploaded as base64). Optional user claim (e.g. “Is this real?”).

**Flow:**

1. **Resolve image URL**  
   If the client sent pasted/uploaded data (`imageData`), the image is uploaded to **Vercel Blob** to get a public URL; that URL is used for the rest of the pipeline. The blob is **deleted in a `finally` block** after the response so the image is not retained.

2. **Google Lens “About This Image” (SerpAPI)**  
   SerpAPI is called with `engine=google_lens`, `type=about_this_image`, and the image URL. The response gives:
   - Header (title, image) when available  
   - **Page results**: where else this image appears (URLs, titles, snippets, **dates**).  
   This is the **genealogical footprint** of the image.

3. **No digital footprint**  
   If the API errors or returns no usable context, we return a **“No Digital Footprint”** result: the image may be rare, heavily edited, or not indexed. We do not invent a timeline.

4. **AWS Bedrock (Claude)**  
   The model receives:
   - User claim  
   - Image history (header + page results with **dates** and links)  
   - Instructions that the **verdict is about the media** (authentic vs. doctored/misleading), not “was the user’s claim correct?”  
   - Instructions to build a **timeline** (chronological nodes with label, date, description, link), using dates from the page results and always including the year.  
   - Score = degree of manipulation + confidence (higher = more false/manipulated).  
   Output: verdict (TRUE / FALSE / UNVERIFIED), score, explanation (supports **bold** and Wikipedia-style links), timeline.

**Why this gives confidence:**  
The timeline is grounded in **real index data** (SerpAPI). The LLM only interprets and narrates it. Doctored or repurposed images get FALSE and a high score; the explanation focuses on manipulation, not on validating the user’s wording.

---

### 2. URL analysis (`/api/analyze-url`)

**Input:** URL (article, tweet, etc.) and optional claim.

**Flow:**

1. **Scrape the URL**  
   Cheerio extracts title, description, body, and image URLs. For X/Twitter, we try oEmbed first for a clean title/description and fall back to scraping.

2. **If the page has an image (e.g. tweet with photo)**  
   We run **Google Lens “About This Image”** on the first image URL and merge those page results into the evidence set. So URL analysis can include **reverse-image forensics** on the embedded image.

3. **Gather evidence in parallel**  
   - **Google Fact Check API** (claim/search query)  
   - **SerpAPI**: general web (1-year recency), news, “fact check” query, and site-limited searches for `politifact.com`, `snopes.com`, `factcheck.org`, `factcheck.afp.com`  
   All results are normalized to a unified list (title, link, snippet, **date**, source).

4. **AWS Bedrock (Claude)**  
   Prompt includes: scraped page, search results with dates, optional “About This Image” block, and (when present) **Google Fact Check API** results with an instruction to weigh them heavily. Model returns verdict, score, explanation, timeline (using dates from the provided results).

5. **Overrides for confidence**  
   - If the URL is a **known fact-checker** (PolitiFact/Snopes, etc.) and we detect a verdict in the scraped content, we can override UNVERIFIED with that verdict.  
   - If **Google Fact Check API** returned ratings and the model said UNVERIFIED, we override to TRUE/FALSE based on those ratings.  
   - If **snippet text** from fact-check domains clearly indicates a rating, we override UNVERIFIED.  
   - If still UNVERIFIED, we call **Backboard** and **Gemini** in parallel for a second opinion; the first non-null result overrides.

6. **Relevance filtering**  
   **Gemini** is used to filter fact-check results to those **about the same claim/topic**, so the “Cross-examination” section and timeline don’t mix in unrelated fact-checks.

**Why this gives confidence:**  
Scraped content + multiple search channels + Fact Check API + optional reverse-image + rule-based overrides + second-opinion LLMs. No single source can hide a clear verdict when others have it.

---

### 3. Text (claim) analysis (`/api/analyze-text`)

**Input:** A text claim (e.g. “The moon landing was faked”).

**Flow:**

1. **Evidence in parallel**  
   - **Google Fact Check API** (claim + shortened claim)  
   - **SerpAPI**: general web (1-year), news, “fact check” query, Politifact, Snopes, FactCheck.org, AFP site-limited searches.

2. **AWS Bedrock (Claude)**  
   Claim + all search and Fact Check results (with dates) are sent to the model. Same JSON contract: verdict, score, explanation, timeline.

3. **Overrides**  
   Same pattern as URL: Fact Check API verdicts override UNVERIFIED; snippet-based detection; if still UNVERIFIED, **Backboard** and **Gemini** second opinion in parallel.

4. **Relevance filtering**  
   Gemini filters fact-check results to the claim before returning them in the response.

**Why this gives confidence:**  
Structured fact-check data plus broad search plus second opinions. Timeline and explanation are grounded in real dates and links.

---

## Evidence board (UI)

The front end presents a single, unified **evidence board** per result:

- **Timeline**  
  Chronological nodes (date, label, description, source link). Dates are normalized to “Mon DD, YYYY.” Timeline styling (e.g. green/red) reflects verdict.

- **Verdict**  
  TRUE / FALSE / UNVERIFIED, with a stamp-style visual and short subtitle.

- **Score**  
  One line: large percentage + small “false / misleading” or “accurate.” Score reflects degree of manipulation (or accuracy) and model confidence.

- **Explanation**  
  Rendered with **bold** and optional **links** (e.g. Wikipedia for people/institutions). Links are limited to reference-style links, not duplicate “Relevant sources” links.

- **Relevant sources**  
  Pills linking to the main search/fact-check results used in the analysis.

- **Cross-examination**  
  Fact-check sources (PolitiFact, Snopes, etc.) as pills. Same visual language as Relevant sources.

- **Disclaimer**  
  Short line that the analysis was generated with AI and can be wrong; users are encouraged to check primary sources.

---

## Environment variables

Create a `.env.local` (or set in your deployment) with:

| Variable | Required for | Description |
|----------|------------------|-------------|
| `SERPAPI_KEY` | Image, URL, Text | [SerpAPI](https://serpapi.com/) key for Google Lens, Google Search, Google News. |
| `AWS_BEDROCK_ACCESS_KEY_ID` | Image, URL, Text | AWS access key for Bedrock (or use `AWS_ACCESS_KEY_ID`). |
| `AWS_BEDROCK_SECRET_ACCESS_KEY` | Image, URL, Text | AWS secret key for Bedrock (or use `AWS_BEDROCK_KEY`). |
| `AWS_REGION` | Image, URL, Text | Optional; defaults to `us-east-1`. |
| `GOOGLE_FACT_CHECK_API_KEY` | URL, Text | [Google Fact Check Tools](https://developers.google.com/fact-check/tools/api) API key. Enables authoritative overrides. |
| `BLOB_READ_WRITE_TOKEN` | Image (paste/upload only) | [Vercel Blob](https://vercel.com/docs/storage/vercel-blob) read-write token. Required only when users paste or upload images; optional if they only use public image URLs. |
| `GEMINI_API_KEY` | URL, Text (second opinion + filter) | Google AI Studio key for Gemini. Second opinion when Bedrock returns UNVERIFIED; fact-check relevance filtering. |
| `BACKBOARD_API_KEY` | URL, Text (second opinion) | [Backboard](https://backboard.io/) API key. Second opinion when Bedrock returns UNVERIFIED. |

Missing optional keys are handled gracefully (e.g. no second opinion, no Blob upload); the app still runs with the minimum set (SerpAPI + Bedrock for all three flows).

---

## Site icon (favicon)

The app uses a **generated icon** from `app/icon.tsx`: a dark square with “PT” in white. Next.js serves it as the favicon and tab icon automatically.

**To use your own icon instead:**

- **Option A — favicon only:** Add a `favicon.ico` file to the `app/` directory (e.g. 32×32). Next.js will prefer it for the favicon; the generated `icon.tsx` still provides other sizes if needed.
- **Option B — replace the generated icon:** Remove `app/icon.tsx` and add image file(s) in `app/` with the [Next.js metadata file names](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/app-icons): `icon.png` (or `icon.ico`), and optionally `apple-icon.png` for Apple devices. Supported formats: `.ico`, `.png`, `.jpg`, `.svg` for `icon`; `.jpg`, `.png` for `apple-icon`.

No changes to `layout.tsx` are required; Next.js reads these files from `app/` automatically.

---

## Run locally

```bash
npm install
cp .env.example .env.local   # if you have one; otherwise create .env.local with the vars above
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Paste an image URL, paste or upload an image, paste a URL, or paste a claim and run an investigation.

---

## Project structure (high level)

```
app/
  page.tsx              # Main UI: hero input, submit, results dashboard (timeline, verdict, score, sources, cross-examination)
  layout.tsx            # Root layout, fonts, footer
  icon.tsx              # Generated site icon (favicon / tab icon); replace with favicon.ico or icon.png if desired
  globals.css           # Theme, timeline and verdict styling
  api/
    analyze/route.ts    # Image pipeline: Blob (optional) → SerpAPI Lens → Bedrock → response; Blob cleanup
    analyze-url/route.ts# URL pipeline: scrape → optional Lens → Fact Check + SerpAPI → Bedrock → overrides → Gemini filter
    analyze-text/route.ts # Text pipeline: Fact Check + SerpAPI → Bedrock → overrides → Gemini filter
components/             # PaperTrailsLogo, TextEncrypted, etc.
lib/
  gemini.ts             # Gemini second opinion + fact-check relevance filter
  backboard.ts          # Backboard second opinion
```

---

## License & credits

Private. Built with 🤍 by **Team Axiom** @ Hack_NCState 2026.
