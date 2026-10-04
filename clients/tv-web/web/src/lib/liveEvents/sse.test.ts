import { describe, expect, it } from "vitest";
import { createSseParser, type SseFrame } from "./sse";

function collect() {
  const frames: SseFrame[] = [];
  const comments: string[] = [];
  const parser = createSseParser({ onFrame: (f) => frames.push(f), onComment: (c) => comments.push(c) });
  return { frames, comments, parser };
}

describe("createSseParser", () => {
  it("parses id, event and data from LF frames", () => {
    const { frames, parser } = collect();
    parser.push('id: 7\nevent: change\ndata: {"a":1}\n\n');
    expect(frames).toEqual([{ id: "7", event: "change", data: '{"a":1}' }]);
  });

  it("handles CRLF and bare CR line endings", () => {
    const { frames, parser } = collect();
    parser.push("id: 1\r\nevent: ready\r\ndata: x\r\n\r\n");
    parser.push("id: 2\revent: change\rdata: y\r\r");
    expect(frames.map((f) => [f.id, f.event, f.data])).toEqual([
      ["1", "ready", "x"],
      ["2", "change", "y"],
    ]);
  });

  it("reassembles frames split at arbitrary chunk boundaries, including mid-CRLF", () => {
    const { frames, parser } = collect();
    const text = 'id: 9\r\nevent: change\r\ndata: {"seq":9}\r\n\r\n';
    for (const ch of text) parser.push(ch);
    expect(frames).toEqual([{ id: "9", event: "change", data: '{"seq":9}' }]);
  });

  it("treats comment lines as heartbeats, not frames", () => {
    const { frames, comments, parser } = collect();
    parser.push(": keep-alive\n\n: again\n");
    expect(frames).toEqual([]);
    expect(comments).toEqual(["keep-alive", "again"]);
  });

  it("joins multi-line data and defaults the event name", () => {
    const { frames, parser } = collect();
    parser.push("data: a\ndata: b\n\n");
    expect(frames).toEqual([{ id: undefined, event: "message", data: "a\nb" }]);
  });

  it("does not leak an id into the next frame and drops partial frames on reset", () => {
    const { frames, parser } = collect();
    parser.push("id: 1\ndata: a\n\ndata: b\n\n");
    expect(frames[1]?.id).toBeUndefined();
    parser.push("id: 5\ndata: half");
    parser.reset();
    parser.push("\n\n");
    expect(frames).toHaveLength(2);
  });
});
