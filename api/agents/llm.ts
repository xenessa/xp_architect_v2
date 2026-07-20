import type { ZodType } from "zod";
import { getDb } from "../queries/connection";
import { llmCallLogs, type Project } from "@db/schema";

/**
 * Model-agnostic LLM gateway (build doc §4).
 *
 * Provider resolution order (§4.5, §9.3):
 *   1. Project BYO endpoint (projects.llm_endpoint_json) — privacy tier 2
 *   2. Environment config: LLM_BASE_URL + LLM_API_KEY + LLM_MODEL
 *      (any OpenAI-compatible endpoint: Moonshot/Kimi, Anthropic-compatible, etc.)
 *   3. Dev mode — no credentials configured: agents use scripted fallbacks so
 *      the full product flow stays demoable. Logged as model "dev-scripted".
 *
 * Logging is metadata-only (§4.3): prompt/response content is never stored.
 */

export type LlmMessage = { role: "system" | "user" | "assistant"; content: string };

export interface LlmCall {
  agent: "onboarding" | "assessment" | "discovery" | "compiler" | "team";
  purpose: string;
  messages: LlmMessage[];
  maxTokens?: number;
  temperature?: number;
  projectId?: number;
  sessionId?: number;
  /**
   * User-facing conversational turn: fail fast (well under the hosting
   * platform's edge timeout, so the client gets a real JSON error instead of
   * an HTML gateway page) and skip the empty-content retry.
   */
  interactive?: boolean;
  /**
   * Reasoning control for reasoning models (OpenRouter only — the param is
   * not sent to other OpenAI-compatible endpoints, which may strict-validate).
   * "off" disables hidden reasoning entirely: K3 replies drop from ~15–75s to
   * ~5–10s. "low" (default) keeps light reasoning for batch synthesis quality.
   */
  reasoning?: "off" | "low";
}

export interface LlmResult {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  devMode: boolean;
}

interface EndpointConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

function envEndpoint(): EndpointConfig | null {
  // Primary names (LLM_*), then common provider-style names so platform- or
  // user-injected config is picked up without code changes.
  const baseUrl =
    process.env.LLM_BASE_URL ??
    process.env.OPENAI_BASE_URL ??
    (process.env.OPENROUTER_API_KEY ? "https://openrouter.ai/api/v1" : undefined);
  const apiKey =
    process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY ?? process.env.OPENROUTER_API_KEY;
  if (!baseUrl || !apiKey) return null;
  return {
    baseUrl,
    apiKey,
    model: process.env.LLM_MODEL ?? process.env.OPENAI_MODEL ?? "openrouter/auto",
  };
}

/** For the owner-only status endpoint — names only, never secrets. */
export function envEndpointInfo(): { configured: boolean; baseUrl?: string; model?: string } {
  const ep = envEndpoint();
  return ep
    ? { configured: true, baseUrl: ep.baseUrl, model: ep.model }
    : { configured: false };
}

function byoEndpoint(project?: Project | null): EndpointConfig | null {
  const cfg = project?.llmEndpointJson as
    | { baseUrl?: string; apiKey?: string; model?: string }
    | null
    | undefined;
  if (cfg?.baseUrl && cfg?.apiKey && cfg?.model) {
    return { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model };
  }
  return null;
}

/** Which mode will calls run in for this project? Agents branch on this. */
export function gatewayMode(project?: Project | null): "live" | "dev" {
  return byoEndpoint(project) ?? envEndpoint() ? "live" : "dev";
}

async function logCall(call: LlmCall, result: Omit<LlmResult, "devMode">) {
  try {
    await getDb().insert(llmCallLogs).values({
      projectId: call.projectId ?? null,
      sessionId: call.sessionId ?? null,
      agent: call.agent,
      purpose: call.purpose,
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      latencyMs: result.latencyMs,
    });
  } catch (err) {
    console.warn("[llm] failed to write call log:", err);
  }
}

async function completeLive(
  call: LlmCall,
  endpoint: EndpointConfig,
): Promise<LlmResult> {
  const started = Date.now();
  const interactive = call.interactive ?? false;
  // Interactive turns must fail before the hosting platform's edge timeout
  // (observed ≥75s) so the client receives a parseable JSON error; batch work
  // (deliverables) gets more headroom.
  const timeoutMs = interactive ? 50_000 : 100_000;
  // Reasoning models (e.g. moonshotai/kimi-k3) burn tokens on hidden reasoning
  // before producing content — enforce headroom, and let callers disable or
  // lighten reasoning (see LlmCall.reasoning). The unified `reasoning` param
  // is OpenRouter-specific — don't send it to arbitrary OpenAI-compatible
  // BYO endpoints, which may strict-validate.
  const isOpenRouter = /openrouter/i.test(endpoint.baseUrl);
  const reasoningParam = !isOpenRouter
    ? {}
    : call.reasoning === "off"
      ? { reasoning: { enabled: false } }
      : { reasoning: { effort: "low" } };
  let budget = Math.max(call.maxTokens ?? 1500, 2500);

  const maxAttempts = interactive ? 1 : 2; // batch may retry once on empty content
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let resp: Response;
    try {
      resp = await fetch(`${endpoint.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${endpoint.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: endpoint.model,
          messages: call.messages,
          temperature: call.temperature ?? 0.7,
          max_tokens: budget,
          ...reasoningParam,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      // AbortSignal.timeout / network failure — surface a friendly, retryable message.
      console.warn(`[llm] request failed (${(err as Error).name}): ${(err as Error).message}`);
      throw new Error("The model took too long to respond — please try again.");
    }

    if (!resp.ok) {
      const body = (await resp.text()).slice(0, 300);
      throw new Error(`LLM endpoint error (${resp.status}): ${body}`);
    }

    const data = (await resp.json()) as {
      choices?: { message?: { content?: string | null } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = data.choices?.[0]?.message?.content ?? "";

    if (text.trim()) {
      const result = {
        text,
        model: endpoint.model,
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
        latencyMs: Date.now() - started,
      };
      await logCall(call, result);
      return { ...result, devMode: false };
    }

    console.warn(`[llm] empty content (attempt ${attempt + 1}, budget ${budget})`);
    budget *= 2;
  }

  throw new Error("The model returned an empty response — please try again.");
}

export const llm = {
  /**
   * Single completion entry point. Throws in live mode on endpoint failure;
   * in dev mode agents never reach the network (see agent-level scripting).
   */
  async complete(call: LlmCall, project?: Project | null): Promise<LlmResult> {
    const endpoint = byoEndpoint(project) ?? envEndpoint();
    if (!endpoint) {
      throw new Error(
        "llm.complete called with no provider configured (dev mode must be handled by the agent)",
      );
    }
    return completeLive(call, endpoint);
  },

  /** Convenience: log a dev-mode (scripted) "call" for cost/flow parity. */
  async logDevCall(call: LlmCall, outputChars: number) {
    await logCall(call, {
      text: "",
      model: "dev-scripted",
      inputTokens: 0,
      outputTokens: Math.ceil(outputChars / 4),
      latencyMs: 0,
    });
  },

  /**
   * Structured-output mode (§4.2): parses the response against a Zod schema;
   * on parse failure, retries once with a repair prompt, then throws.
   */
  async completeJson<T>(
    call: LlmCall,
    schema: ZodType<T>,
    project?: Project | null,
  ): Promise<T> {
    const tryParse = (text: string): T | null => {
      try {
        const cleaned = text.trim().replace(/^```(?:json)?|```$/g, "").trim();
        return schema.parse(JSON.parse(cleaned));
      } catch {
        return null;
      }
    };

    const raw = await this.complete(call, project);
    const first = tryParse(raw.text);
    if (first !== null) return first;

    const repaired = await this.complete(
      {
        ...call,
        purpose: `${call.purpose}.repair`,
        temperature: 0.2,
        messages: [
          ...call.messages,
          { role: "assistant", content: raw.text },
          {
            role: "user",
            content:
              "That was not valid JSON matching the required contract. Respond again with STRICT JSON only, no markdown fences, matching the schema exactly.",
          },
        ],
      },
      project,
    );
    const second = tryParse(repaired.text);
    if (second === null) {
      throw new Error(`Agent ${call.agent} returned unparseable output twice`);
    }
    return second;
  },
};
