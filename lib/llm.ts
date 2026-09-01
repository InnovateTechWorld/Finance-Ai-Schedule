/**
 * Model adapter with two routes.
 *
 *  1. Bedrock bearer  — AWS_BEARER_TOKEN_BEDROCK set. This is raw HTTP on
 *     purpose: the bearer mode is an `Authorization: Bearer` header against
 *     bedrock-runtime, which the SigV4-based Bedrock SDK client does not carry.
 *  2. First-party SDK — ANTHROPIC_API_KEY set. Used when no bearer token is present.
 *
 * Both speak the same Messages body, so callers see one interface.
 */
import Anthropic from "@anthropic-ai/sdk";

export type Block =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "document"; source: { type: "base64"; media_type: string; data: string } };

/**
 * Thinking is on by default for Sonnet 5, which is most of the latency on a
 * two-document run. Extraction is a transcription task, not a reasoning one,
 * so it ships disabled — set MODEL_THINKING=adaptive to turn it back on if a
 * schedule ever comes back sloppier than it should.
 */
function thinkingParam(): { type: "adaptive" } | { type: "disabled" } {
  return process.env.MODEL_THINKING?.trim().toLowerCase() === "adaptive"
    ? { type: "adaptive" }
    : { type: "disabled" };
}

export function thinkingEnabled(): boolean {
  return thinkingParam().type === "adaptive";
}

export interface AskOptions {
  system: string;
  blocks: Block[];
  maxTokens?: number;
}

export class ModelUnconfigured extends Error {}

export function modelRoute(): "bedrock" | "anthropic" | "none" {
  if (process.env.AWS_BEARER_TOKEN_BEDROCK?.trim()) return "bedrock";
  if (process.env.ANTHROPIC_API_KEY?.trim()) return "anthropic";
  return "none";
}

export function modelLabel(): string {
  const route = modelRoute();
  if (route === "bedrock") return bedrockModelId();
  if (route === "anthropic") return process.env.ANTHROPIC_MODEL_ID?.trim() || "claude-sonnet-5";
  return "unconfigured";
}

/** Geos that front a cross-region inference profile. */
const GEO_PREFIXES = ["us-gov", "us", "eu", "apac", "au", "jp", "global"] as const;

/**
 * Sonnet 5 (and Opus 4.7/4.8, Haiku 4.5) cannot be invoked on-demand by bare
 * model ID — AWS only exposes them behind a cross-region inference profile,
 * whose ID is the model ID with a geo prefix (`us.anthropic.claude-sonnet-5`).
 * So the prefix is derived from AWS_REGION unless the caller supplied their own
 * prefixed ID, a profile ARN, or an explicit BEDROCK_INFERENCE_GEO.
 *
 * Confirm what your account can actually invoke with:
 *   aws bedrock list-inference-profiles --region <region>
 */
export function bedrockModelId(): string {
  const raw = process.env.BEDROCK_MODEL_ID?.trim() || "anthropic.claude-sonnet-5";
  if (raw.startsWith("arn:")) return raw;
  if (GEO_PREFIXES.some((p) => raw.startsWith(`${p}.`))) return raw;

  const geo = inferenceGeo();
  return geo ? `${geo}.${raw}` : raw;
}

function inferenceGeo(): string | undefined {
  const explicit = process.env.BEDROCK_INFERENCE_GEO?.trim().replace(/\.$/, "");
  if (explicit) return explicit;

  const region = (process.env.AWS_REGION?.trim() || "us-east-1").toLowerCase();
  if (region.startsWith("us-gov-")) return "us-gov";
  if (region.startsWith("us-")) return "us";
  if (region.startsWith("eu-")) return "eu";
  if (region.startsWith("ap-northeast-1")) return "jp";
  if (region.startsWith("ap-southeast-2") || region.startsWith("ap-southeast-4")) return "au";
  if (region.startsWith("ap-")) return "apac";
  // Anywhere else (ca-, sa-, me-, af-, il-): no profile mapping we can trust.
  // Leave the ID bare and let the 400 handler below tell the user what to set.
  return undefined;
}

export async function ask({ system, blocks, maxTokens = 16000 }: AskOptions): Promise<string> {
  const route = modelRoute();
  if (route === "none") {
    throw new ModelUnconfigured(
      "No model credentials. Set AWS_BEARER_TOKEN_BEDROCK (Bedrock) or ANTHROPIC_API_KEY.",
    );
  }
  return route === "bedrock"
    ? askBedrockBearer(system, blocks, maxTokens)
    : askAnthropic(system, blocks, maxTokens);
}

async function askAnthropic(system: string, blocks: Block[], maxTokens: number): Promise<string> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!.trim() });
  const stream = client.messages.stream({
    model: modelLabel(),
    max_tokens: maxTokens,
    // The installed SDK's typings predate `adaptive`; the wire accepts it.
    thinking: thinkingParam() as Anthropic.ThinkingConfigParam,
    system,
    messages: [{ role: "user", content: blocks as Anthropic.ContentBlockParam[] }],
  });
  const final = await stream.finalMessage();
  return textOf(final.content);
}

async function askBedrockBearer(system: string, blocks: Block[], maxTokens: number): Promise<string> {
  const region = process.env.AWS_REGION?.trim() || "us-east-1";
  const model = modelLabel();
  const url = `https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(model)}/invoke`;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 180_000);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.AWS_BEARER_TOKEN_BEDROCK!.trim()}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: maxTokens,
        thinking: thinkingParam(),
        system,
        messages: [{ role: "user", content: blocks }],
      }),
      signal: ac.signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error("The model took longer than 3 minutes — try fewer files.");
    throw new Error(`Bedrock unreachable: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = (await res.text()).slice(0, 500);

    // The most common first-run failure: a model that only exists behind a
    // cross-region inference profile, invoked by bare ID.
    if (/inference profile/i.test(body)) {
      const suggestion = inferenceGeo()
        ? `Set BEDROCK_MODEL_ID to a profile ID your account can invoke.`
        : `AWS_REGION "${region}" has no inference-profile geo I can derive — set BEDROCK_MODEL_ID (or BEDROCK_INFERENCE_GEO) explicitly.`;
      throw new Error(
        `Bedrock will not invoke "${model}" on-demand — it needs a cross-region inference profile. ` +
          `${suggestion} List what is available with: ` +
          `aws bedrock list-inference-profiles --region ${region}`,
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        "Bedrock rejected the bearer token. Check AWS_BEARER_TOKEN_BEDROCK, the region, and that the key's " +
          "IAM policy allows bedrock:InvokeModel on the inference-profile ARN as well as the base model ARN.",
      );
    }
    if (res.status === 429) throw new Error("Bedrock is rate-limiting this key. Wait a moment and retry.");
    throw new Error(`Bedrock error ${res.status}: ${body}`);
  }
  const json = (await res.json()) as { content?: unknown };
  return textOf(json.content);
}

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((b: any) => b?.type === "text" && typeof b.text === "string")
    .map((b: any) => b.text)
    .join("\n")
    .trim();
}

/**
 * Models wrap JSON in prose, fences, or a leading apology. Pull the first
 * balanced object out rather than trusting the whole response to parse.
 */
export function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fenced?.[1], trimmed, sliceBalanced(trimmed)].filter(Boolean) as string[];
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      /* try the next candidate */
    }
  }
  throw new Error("The model did not return usable JSON. Try again, or upload clearer documents.");
}

function sliceBalanced(s: string): string | undefined {
  const start = s.indexOf("{");
  if (start < 0) return undefined;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return s.slice(start, i + 1);
  }
  return undefined;
}
