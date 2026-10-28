/**
 * A minimal Server-Sent Events reader over fetch (the extension host has no EventSource): one connection, parsed
 * into `{event, data}` messages; an HTTP failure surfaces as `SseHttpError` with the `Retry-After` the gateway sent.
 * @adr 0670
 */

/** One SSE message. */
export interface SseMessage {
  event: string;
  data: string;
}

/** A non-2xx answer to the stream request. */
export class SseHttpError extends Error {
  /** `status` is the HTTP status; `retryAfterSec` the `Retry-After` header, when sent. */
  constructor(
    readonly status: number,
    readonly retryAfterSec: number | null,
  ) {
    super(`SSE request failed with HTTP ${status}`);
  }
}

/**
 * Split an SSE text buffer into complete messages; returns them and the unfinished tail.
 * Lines starting with `:` are comments; a message without `event:` is a `message`.
 */
export function parseSse(buffer: string): { messages: SseMessage[]; rest: string } {
  const messages: SseMessage[] = [];
  const normalized = buffer.replace(/\r\n?/g, "\n");
  const blocks = normalized.split("\n\n");
  const rest = blocks.pop() ?? "";
  for (const block of blocks) {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (!line || line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
      if (field === "event") event = value;
      else if (field === "data") data.push(value);
    }
    if (data.length > 0) messages.push({ event, data: data.join("\n") });
  }
  return { messages, rest };
}

/**
 * Open one SSE connection and deliver its messages until the server closes it or `signal` aborts.
 * Resolves on a normal end; rejects with `SseHttpError` on a non-2xx answer.
 */
export async function readSse(
  url: string,
  headers: Record<string, string>,
  onMessage: (message: SseMessage) => void,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch(url, { headers: { ...headers, Accept: "text/event-stream" }, signal });
  if (!res.ok || !res.body) {
    const retryAfter = Number(res.headers.get("retry-after"));
    throw new SseHttpError(res.status, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseSse(buffer);
    buffer = parsed.rest;
    for (const message of parsed.messages) onMessage(message);
  }
}
