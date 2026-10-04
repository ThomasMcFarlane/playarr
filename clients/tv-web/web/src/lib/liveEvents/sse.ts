/**
 * Incremental Server-Sent Events parser. Feed it decoded text in arbitrary
 * chunks (a frame may straddle chunks, line endings may be CRLF, LF or CR);
 * it calls `onFrame` once per completed event and `onComment` for `:` lines
 * (the server's heartbeats).
 */
export interface SseFrame {
  /** Last `id:` seen in this frame, if any. */
  id?: string;
  /** `event:` name; defaults to "message" per the SSE specification. */
  event: string;
  data: string;
}

export interface SseParser {
  push(chunk: string): void;
  /** Drops any partial frame (used when a connection ends). */
  reset(): void;
}

export function createSseParser(handlers: {
  onFrame: (frame: SseFrame) => void;
  onComment?: (text: string) => void;
}): SseParser {
  let buffer = "";
  let skipLeadingLf = false;
  let id: string | undefined;
  let event = "";
  let data: string[] = [];

  const dispatch = () => {
    if (data.length > 0) {
      handlers.onFrame({ id, event: event || "message", data: data.join("\n") });
    }
    // A frame only reports an id it carried; callers keep the connection cursor.
    id = undefined;
    event = "";
    data = [];
  };

  const line = (text: string) => {
    if (text === "") {
      dispatch();
      return;
    }
    if (text.startsWith(":")) {
      handlers.onComment?.(text.slice(1).trimStart());
      return;
    }
    const colon = text.indexOf(":");
    const field = colon === -1 ? text : text.slice(0, colon);
    let value = colon === -1 ? "" : text.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") data.push(value);
    else if (field === "event") event = value;
    else if (field === "id" && !value.includes("\0")) id = value;
    // `retry` and unknown fields are ignored.
  };

  return {
    push(chunk) {
      let text = chunk;
      if (skipLeadingLf && text.startsWith("\n")) text = text.slice(1);
      skipLeadingLf = false;
      buffer += text;
      let start = 0;
      for (let i = 0; i < buffer.length; i += 1) {
        const ch = buffer[i];
        if (ch !== "\n" && ch !== "\r") continue;
        line(buffer.slice(start, i));
        if (ch === "\r") {
          if (i + 1 < buffer.length) {
            if (buffer[i + 1] === "\n") i += 1;
          } else {
            skipLeadingLf = true;
          }
        }
        start = i + 1;
      }
      buffer = buffer.slice(start);
    },
    reset() {
      buffer = "";
      skipLeadingLf = false;
      id = undefined;
      event = "";
      data = [];
    },
  };
}
