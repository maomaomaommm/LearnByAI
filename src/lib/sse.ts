export type ParsedSseEvent = {
  event: string;
  data: string;
  id?: string;
  retry?: number;
};

export function encodeSseEvent(event: string, data?: unknown) {
  const lines = [`event: ${event}`];

  if (data !== undefined) {
    const payload = typeof data === "string" ? data : JSON.stringify(data);
    for (const line of payload.split(/\r?\n/u)) {
      lines.push(`data: ${line}`);
    }
  }

  return `${lines.join("\n")}\n\n`;
}

export function createSseParser(onEvent: (event: ParsedSseEvent) => void) {
  let buffer = "";

  return {
    feed(chunk: string) {
      buffer += chunk;

      while (true) {
        const boundary = findEventBoundary(buffer);
        if (boundary < 0) return;

        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + eventBoundaryLength(buffer, boundary));
        parseRawSseEvent(rawEvent, onEvent);
      }
    },
    flush() {
      if (!buffer.trim()) {
        buffer = "";
        return;
      }

      parseRawSseEvent(buffer, onEvent);
      buffer = "";
    },
  };
}

function findEventBoundary(value: string) {
  const lf = value.indexOf("\n\n");
  const crlf = value.indexOf("\r\n\r\n");

  if (lf < 0) return crlf;
  if (crlf < 0) return lf;
  return Math.min(lf, crlf);
}

function eventBoundaryLength(value: string, index: number) {
  return value.startsWith("\r\n\r\n", index) ? 4 : 2;
}

function parseRawSseEvent(rawEvent: string, onEvent: (event: ParsedSseEvent) => void) {
  const data: string[] = [];
  let event = "message";
  let id: string | undefined;
  let retry: number | undefined;

  for (const rawLine of rawEvent.split(/\r?\n/u)) {
    if (!rawLine || rawLine.startsWith(":")) continue;

    const separator = rawLine.indexOf(":");
    const field = separator >= 0 ? rawLine.slice(0, separator) : rawLine;
    const value = separator >= 0 ? rawLine.slice(separator + 1).replace(/^ /u, "") : "";

    if (field === "event") event = value || "message";
    else if (field === "data") data.push(value);
    else if (field === "id") id = value;
    else if (field === "retry") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) retry = parsed;
    }
  }

  onEvent({
    event,
    data: data.join("\n"),
    id,
    retry,
  });
}
