/**
 * Tests of the SSE parser.
 * @adr 0670
 */
import { describe, expect, it } from "vitest";
import { parseSse } from "./sse";

describe("parseSse", () => {
  it("parses named and default events and keeps the unfinished tail", () => {
    const { messages, rest } = parseSse('event: notification\ndata: {"a":1}\n\ndata: x\ndata: y\n\n: keep-alive\n\ndata: part');
    expect(messages).toEqual([
      { event: "notification", data: '{"a":1}' },
      { event: "message", data: "x\ny" },
    ]);
    expect(rest).toBe("data: part");
  });

  it("accepts CRLF line endings", () => {
    expect(parseSse("data: 1\r\n\r\n").messages).toEqual([{ event: "message", data: "1" }]);
  });
});
