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
  const baseUrl = process.env.LLM_BASE_URL;
  const apiKey = process.env.LLM_API_KEY;
  if (!baseUrl || !apiKey) return null;
  return { baseUrl, apiKey, model: process.env.LLM_MODEL ?? "kimi-k2" };
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
  const resp = await fetch(`${endpoint.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${endpoint.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: endpoint.model,
      messages: call.messages,
      temperature: call.temperature ?? 0.7,
      max_tokens: call.maxTokens ?? 1500,
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!resp.ok) {
    throw new Error(`LLM endpoint error (${resp.status}): ${await resp.text()}`);
  }

  const data = (await resp.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const result = {
    text: data.choices?.[0]?.message?.content ?? "",
    model: endpoint.model,
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
    latencyMs: Date.now() - started,
  };
  await logCall(call, result);
  return { ...result, devMode: false };
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
