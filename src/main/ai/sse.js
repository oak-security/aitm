"use strict";

// Parse a fetch Server-Sent-Events response body into JSON events.
// Yields { json } for each `data:` payload, or { done: true } for the [DONE] sentinel.
async function* sseEvents(response) {
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of response.body) {
    buf += decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const data = raw
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .join("");
      if (!data) continue;
      if (data === "[DONE]") {
        yield { done: true };
        continue;
      }
      try {
        yield { json: JSON.parse(data) };
      } catch {
        /* skip keep-alives / non-JSON frames */
      }
    }
  }
}

module.exports = { sseEvents };
