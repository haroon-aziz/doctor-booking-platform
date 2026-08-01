"use client";

import { AlertTriangle, ArrowUp, Bot, Loader2, Sparkles, User } from "lucide-react";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

/**
 * The assistant conversation.
 *
 * Renders a deliberately tiny subset of markdown (bold, italics, links) rather
 * than pulling in a parser: the assistant's output format is ours to control,
 * and shipping a full markdown renderer for three constructs would mean
 * sanitising arbitrary HTML on a page that discusses medical symptoms.
 */

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  usedFallback?: boolean;
  triageLevel?: string;
}

const SUGGESTIONS = [
  "I have had a sore throat and earache for four days",
  "How do I reschedule an appointment?",
  "My child has had a fever since yesterday",
  "What does a video consultation cost?",
];

function renderInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|_[^_]+_|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let key = 0;

  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) nodes.push(text.slice(lastIndex, index));

    const token = match[0];

    if (token.startsWith("**")) {
      nodes.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("_")) {
      nodes.push(
        <em key={key++} className="text-muted-foreground">
          {token.slice(1, -1)}
        </em>,
      );
    } else {
      const label = token.slice(1, token.indexOf("]"));
      const href = token.slice(token.indexOf("(") + 1, -1);
      // Only same-origin paths are linkified, so a model cannot emit an
      // off-site link that looks like it came from us.
      nodes.push(
        href.startsWith("/") ? (
          <a key={key++} href={href} className="font-medium text-primary hover:underline">
            {label}
          </a>
        ) : (
          <span key={key++}>{label}</span>
        ),
      );
    }

    lastIndex = index + token.length;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function MessageBody({ content }: { content: string }) {
  return (
    <>
      {content.split("\n\n").map((paragraph, index) => (
        <p key={index} className={cn(index > 0 && "mt-3")}>
          {renderInline(paragraph)}
        </p>
      ))}
    </>
  );
}

export function AssistantChat() {
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [input, setInput] = React.useState("");
  const [streaming, setStreaming] = React.useState(false);
  const [driver, setDriver] = React.useState<"ollama" | "fallback" | null>(null);

  const endRef = React.useRef<HTMLDivElement>(null);
  const abortRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    void fetch("/api/ai/chat")
      .then((response) => response.json())
      .then((data: { driver: "ollama" | "fallback" }) => setDriver(data.driver))
      .catch(() => setDriver("fallback"));
  }, []);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  React.useEffect(() => () => abortRef.current?.abort(), []);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;

    const userMessage: Message = { id: crypto.randomUUID(), role: "user", content: trimmed };
    const assistantId = crypto.randomUUID();

    const history = messages.map(({ role, content }) => ({ role, content }));

    setMessages((current) => [
      ...current,
      userMessage,
      { id: assistantId, role: "assistant", content: "" },
    ]);
    setInput("");
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, history }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const event of events) {
          const line = event.trim();
          if (!line.startsWith("data:")) continue;

          const payload = line.slice(5).trim();
          if (payload === "[DONE]") continue;

          const chunk = JSON.parse(payload) as {
            type: string;
            content?: string;
            usedFallback?: boolean;
            triageLevel?: string;
          };

          setMessages((current) =>
            current.map((message) =>
              message.id !== assistantId
                ? message
                : {
                    ...message,
                    content:
                      chunk.type === "delta"
                        ? message.content + (chunk.content ?? "")
                        : message.content,
                    usedFallback: chunk.usedFallback ?? message.usedFallback,
                    triageLevel: chunk.triageLevel ?? message.triageLevel,
                  },
            ),
          );
        }
      }
    } catch (error) {
      if ((error as Error).name === "AbortError") return;

      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId
            ? {
                ...message,
                content:
                  "I could not reach the assistant. You can still browse doctors by specialty from the directory.",
              }
            : message,
        ),
      );
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  return (
    <div className="flex h-[min(70vh,640px)] flex-col rounded-xl border bg-card">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary">
            <Sparkles aria-hidden className="size-4" />
          </span>
          <div>
            <p className="text-sm font-medium">Health assistant</p>
            <p className="text-xs text-muted-foreground">
              {driver === "ollama"
                ? "Local model"
                : driver === "fallback"
                  ? "Offline triage engine"
                  : "Connecting…"}
            </p>
          </div>
        </div>
        {driver === "fallback" && (
          <Badge variant="secondary" title="Ollama is not running; answers come from the built-in rule engine">
            Offline mode
          </Badge>
        )}
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <span className="grid size-12 place-items-center rounded-xl bg-accent text-accent-foreground">
              <Bot aria-hidden className="size-6" />
            </span>
            <div className="max-w-sm space-y-1">
              <p className="font-medium">Describe your symptoms</p>
              <p className="text-sm text-muted-foreground">
                I will suggest which specialty fits and how soon you should be seen. I cannot
                diagnose.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => void send(suggestion)}
                  className="rounded-full border px-3 py-1.5 text-xs transition-colors hover:bg-accent"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={cn("flex gap-3", message.role === "user" && "justify-end")}
            >
              {message.role === "assistant" && (
                <span className="grid size-8 shrink-0 place-items-center self-start rounded-lg bg-accent text-accent-foreground">
                  <Bot aria-hidden className="size-4" />
                </span>
              )}

              <div
                className={cn(
                  "max-w-[80%] rounded-xl px-4 py-2.5 text-sm",
                  message.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : message.triageLevel === "EMERGENCY"
                      ? "border border-destructive/40 bg-destructive/10"
                      : "bg-muted",
                )}
              >
                {message.role === "assistant" &&
                  message.triageLevel === "EMERGENCY" && (
                    <p className="mb-2 flex items-center gap-1.5 font-semibold text-destructive">
                      <AlertTriangle aria-hidden className="size-4" />
                      Seek emergency care
                    </p>
                  )}

                {message.content ? (
                  <MessageBody content={message.content} />
                ) : (
                  <Loader2 aria-hidden className="size-4 animate-spin text-muted-foreground" />
                )}
              </div>

              {message.role === "user" && (
                <span className="grid size-8 shrink-0 place-items-center self-start rounded-lg bg-secondary text-secondary-foreground">
                  <User aria-hidden className="size-4" />
                </span>
              )}
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send(input);
        }}
        className="border-t p-3"
      >
        <div className="flex items-end gap-2">
          <label htmlFor="assistant-input" className="sr-only">
            Describe your symptoms
          </label>
          <textarea
            id="assistant-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send(input);
              }
            }}
            rows={1}
            maxLength={2000}
            placeholder="Describe your symptoms, or ask about booking…"
            className="max-h-32 min-h-10 flex-1 resize-none rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button type="submit" size="icon" disabled={!input.trim() || streaming}>
            {streaming ? (
              <Loader2 aria-hidden className="animate-spin" />
            ) : (
              <ArrowUp aria-hidden />
            )}
            <span className="sr-only">Send</span>
          </Button>
        </div>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          Not a diagnosis. In an emergency, call your local emergency number.
        </p>
      </form>
    </div>
  );
}
