import { logger } from "@/lib/logger";

import { fallbackReply, triage } from "./fallback-engine";
import { OllamaUnavailableError, isOllamaAvailable, streamChat, type OllamaMessage } from "./ollama.client";

/**
 * The assistant orchestrator.
 *
 * Two rules govern everything here:
 *
 *   1. **Emergencies never reach the model.** If the rule engine flags a
 *      possible emergency, that answer is returned verbatim and the LLM is not
 *      consulted at all. A local model must not be given the opportunity to
 *      soften "call an ambulance" into "you may want to rest".
 *
 *   2. **Failure is invisible to the patient.** If Ollama is missing, slow or
 *      broken, the rule engine answers instead. The user gets a useful reply
 *      either way; only the `usedFallback` flag records which path ran.
 */

const SYSTEM_PROMPT = `You are the health assistant for MediBook, a doctor booking platform in Pakistan.

Your job:
- Help patients work out which medical specialty fits their symptoms.
- Answer questions about booking, cancelling, rescheduling, fees and video consultations.
- Keep answers short: two or three short paragraphs at most.

Hard rules you must never break:
- You are NOT a doctor. Never give a diagnosis, never name a specific condition as fact, and never recommend or adjust medication or dosage.
- Always recommend seeing a qualified doctor for anything clinical.
- If symptoms sound like an emergency (chest pain, breathing difficulty, stroke signs, severe bleeding, suicidal thoughts), tell the person to seek emergency care immediately and say nothing else clinical.
- Do not invent doctor names, prices, or availability. You do not have access to the live directory.
- If you are unsure, say so and suggest a general physician.

Tone: calm, plain, and respectful. No hype, no emoji. Write in British English.`;

export interface AssistantTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AssistantChunk {
  type: "delta" | "done" | "meta";
  content?: string;
  usedFallback?: boolean;
  triageLevel?: string;
  suggestedSpecialty?: string | null;
}

function toOllamaMessages(history: AssistantTurn[], message: string): OllamaMessage[] {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    // Only the last few turns are sent: a small local model degrades quickly
    // with a long context, and older turns add little for triage.
    ...history.slice(-6).map((turn) => ({ role: turn.role, content: turn.content }) as OllamaMessage),
    { role: "user", content: message },
  ];
}

/**
 * Streams an assistant reply, transparently falling back to the rule engine.
 */
export async function* respond(
  message: string,
  history: AssistantTurn[] = [],
  signal?: AbortSignal,
): AsyncGenerator<AssistantChunk, void, unknown> {
  const outcome = triage(message);

  // Rule 1: emergencies bypass the model entirely.
  if (outcome.triageLevel === "EMERGENCY") {
    const reply = fallbackReply(message);
    logger.warn({ triage: outcome.triageLevel }, "Emergency triage short-circuited the model");

    yield { type: "meta", usedFallback: true, triageLevel: outcome.triageLevel, suggestedSpecialty: outcome.suggestedSpecialty };
    yield { type: "delta", content: reply.content };
    yield { type: "done", usedFallback: true, triageLevel: outcome.triageLevel };
    return;
  }

  const available = await isOllamaAvailable();

  if (!available) {
    const reply = fallbackReply(message);
    logger.info("Ollama unavailable; answering from the rule engine");

    yield { type: "meta", usedFallback: true, triageLevel: outcome.triageLevel, suggestedSpecialty: outcome.suggestedSpecialty };
    yield { type: "delta", content: reply.content };
    yield { type: "done", usedFallback: true, triageLevel: outcome.triageLevel };
    return;
  }

  yield {
    type: "meta",
    usedFallback: false,
    triageLevel: outcome.triageLevel,
    suggestedSpecialty: outcome.suggestedSpecialty,
  };

  let emitted = 0;

  try {
    for await (const delta of streamChat(toOllamaMessages(history, message), { signal })) {
      emitted += delta.length;
      yield { type: "delta", content: delta };
    }
  } catch (error) {
    if (error instanceof OllamaUnavailableError || emitted === 0) {
      // Nothing useful reached the client yet, so the fallback can still take
      // over cleanly.
      logger.warn({ err: error }, "Ollama stream failed; switching to the rule engine");
      const reply = fallbackReply(message);
      yield { type: "delta", content: reply.content };
      yield { type: "done", usedFallback: true, triageLevel: outcome.triageLevel };
      return;
    }

    // A mid-stream failure after partial output: close honestly rather than
    // splicing two different answers together.
    logger.error({ err: error }, "Ollama stream interrupted after partial output");
    yield {
      type: "delta",
      content: "\n\n_The assistant was interrupted. Please ask again if that answer was incomplete._",
    };
  }

  yield { type: "done", usedFallback: false, triageLevel: outcome.triageLevel };
}
