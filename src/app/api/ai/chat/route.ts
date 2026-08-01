import { type NextRequest } from "next/server";
import { z } from "zod";

import { respond, type AssistantTurn } from "@/features/ai/services/assistant.service";
import { getCurrentUser } from "@/lib/auth/session";
import { env } from "@/lib/config/env";
import { logger } from "@/lib/logger";
import { clientIdentifier, rateLimit } from "@/lib/rate-limit";

/**
 * Server-sent events endpoint for the assistant.
 *
 * SSE rather than a JSON response because a local model produces tokens over
 * several seconds and the patient should see them as they arrive. SSE also
 * survives proxies that buffer chunked responses, provided the headers below
 * are present.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  message: z.string().min(1, "Message cannot be empty.").max(2_000),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(4_000),
      }),
    )
    .max(20)
    .default([]),
});

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  const identifier = user?.id ?? clientIdentifier(request.headers);

  // Anonymous visitors get a tighter budget: a local model is CPU-bound and one
  // scripted client could otherwise starve every real user.
  const limit = await rateLimit({
    key: `ai:${identifier}`,
    max: user ? 40 : 12,
    windowSeconds: 300,
    failClosed: false,
  });

  if (!limit.allowed) {
    return Response.json(
      { error: { code: "RATE_LIMITED", message: "Too many messages. Please wait a moment." } },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let parsed: z.infer<typeof bodySchema>;

  try {
    parsed = bodySchema.parse(await request.json());
  } catch (error) {
    logger.warn({ err: error }, "Rejected malformed assistant request");
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid request body." } },
      { status: 400 },
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      try {
        for await (const chunk of respond(
          parsed.message,
          parsed.history as AssistantTurn[],
          request.signal,
        )) {
          send(chunk);
        }
      } catch (error) {
        logger.error({ err: error }, "Assistant stream failed");
        send({
          type: "delta",
          content:
            "The assistant is unavailable right now. You can still [browse doctors](/doctors) or contact support.",
        });
        send({ type: "done", usedFallback: true });
      } finally {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Stops nginx buffering the stream into a single delivery.
      "X-Accel-Buffering": "no",
    },
  });
}

export async function GET() {
  const { isOllamaAvailable } = await import("@/features/ai/services/ollama.client");
  const available = await isOllamaAvailable();

  return Response.json({
    driver: available ? "ollama" : "fallback",
    model: available ? env.OLLAMA_MODEL : "rule-engine",
    // The assistant is always usable — that is the point of the fallback.
    ready: true,
  });
}
