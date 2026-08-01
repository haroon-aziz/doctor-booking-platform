import { env } from "@/lib/config/env";
import { logger } from "@/lib/logger";

/**
 * Minimal Ollama REST client.
 *
 * Ollama exposes a plain HTTP API, so no SDK is needed. The important detail
 * here is the abort handling: a local model on a laptop can stall
 * indefinitely, and a hung request would leave the patient staring at a
 * spinner. Every call carries a hard deadline, after which the caller falls
 * back to the rule engine.
 */

export interface OllamaMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OllamaChatChunk {
  message?: { role: string; content: string };
  done?: boolean;
  eval_count?: number;
}

export class OllamaUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("Ollama is not reachable");
    this.name = "OllamaUnavailableError";
    this.cause = cause;
  }
}

export async function isOllamaAvailable(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2_000);

    const response = await fetch(`${env.OLLAMA_HOST}/api/tags`, {
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timer);

    if (!response.ok) return false;

    const payload = (await response.json()) as { models?: { name: string }[] };
    const models = payload.models ?? [];

    // A running daemon with no model pulled cannot answer anything, so treat
    // that as unavailable rather than failing on the first real request.
    return models.some((model) => model.name.startsWith(env.OLLAMA_MODEL));
  } catch {
    return false;
  }
}

/**
 * Streams a chat completion, yielding content deltas as they arrive.
 * Throws `OllamaUnavailableError` if the daemon cannot be reached, so the
 * caller can switch to the fallback before anything is shown to the user.
 */
export async function* streamChat(
  messages: OllamaMessage[],
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): AsyncGenerator<string, void, unknown> {
  const timeoutMs = options.timeoutMs ?? env.OLLAMA_TIMEOUT_MS;
  const controller = new AbortController();

  const onExternalAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onExternalAbort);
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;

  try {
    response = await fetch(`${env.OLLAMA_HOST}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: env.OLLAMA_MODEL,
        messages,
        stream: true,
        options: {
          // Low temperature: this assistant routes patients to specialists, a
          // task where creative variation is a liability.
          temperature: 0.3,
          top_p: 0.9,
          num_predict: 600,
        },
      }),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onExternalAbort);
    throw new OllamaUnavailableError(error);
  }

  if (!response.ok || !response.body) {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onExternalAbort);
    throw new OllamaUnavailableError(`HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Ollama emits newline-delimited JSON; a chunk may split a line.
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const parsed = JSON.parse(trimmed) as OllamaChatChunk;
          const delta = parsed.message?.content;
          if (delta) yield delta;
          if (parsed.done) return;
        } catch {
          logger.debug({ line: trimmed.slice(0, 120) }, "Skipping malformed Ollama chunk");
        }
      }
    }
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onExternalAbort);
    reader.releaseLock();
  }
}
