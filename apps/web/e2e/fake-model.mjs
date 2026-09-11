// A tiny OpenAI-compatible chat/completions server with controllable output.
// Pi's openai-completions provider streams SSE from `${baseUrl}/chat/completions`.
import { createServer } from "node:http";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

/** The one line the host's title generator puts in front of a title request. */
const TITLE_MARKER = "Create a concise title";

export async function startFakeModel({ reply = "E2E reply", titleReply = null } = {}) {
  const requests = [];
  /** Milliseconds to hold an answer open, so a test can act while a session is
   *  still running. Set it on the returned object; 0 answers at once. */
  const control = { slowMs: 0 };
  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/models") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "e2e-model", object: "model" }] }));
      return;
    }
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      let parsed = null;
      try { parsed = JSON.parse(body); } catch { /* keep null */ }
      requests.push({ url: req.url, body: parsed });
      if (!req.url.endsWith("/chat/completions")) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: `unknown ${req.url}` } }));
        return;
      }
      const lastUser = [...(parsed?.messages ?? [])].reverse().find((m) => m.role === "user");
      const userText = typeof lastUser?.content === "string" ? lastUser.content
        : Array.isArray(lastUser?.content) ? lastUser.content.map((p) => p.text ?? "").join("") : "";
      // Asking for a title is a different request from answering a message, so
      // a test that checks naming can tell one from the other by the answer.
      const text = titleReply && userText.includes(TITLE_MARKER) ? titleReply : `${reply}: ${userText.slice(0, 60)}`;
      const id = `chatcmpl-e2e-${requests.length}`;
      const chunk = (delta, finish = null, usage) => `data: ${JSON.stringify({
        id, object: "chat.completion.chunk", created: 0, model: parsed?.model ?? "e2e-model",
        choices: [{ index: 0, delta, finish_reason: finish }], ...(usage ? { usage } : {}),
      })}\n\n`;
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
      res.write(chunk({ role: "assistant", content: "" }));
      void (async () => {
        if (control.slowMs > 0) await delay(control.slowMs);
        res.write(chunk({ content: text }));
        res.write(chunk({}, "stop", { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }));
        res.write("data: [DONE]\n\n");
        res.end();
      })();
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  return {
    baseUrl,
    requests,
    /** Hold the next answers open for this many ms (0 = answer at once). */
    set slowMs(ms) { control.slowMs = ms; },
    get slowMs() { return control.slowMs; },
    close: () => new Promise((resolve) => server.close(() => resolve())),
    /** How many of the requests so far asked for a title. */
    titleRequests: () => requests.filter((r) => JSON.stringify(r.body?.messages ?? []).includes(TITLE_MARKER)).length,
    /** Concatenated text of every message in every request so far. */
    transcript: () => JSON.stringify(requests.map((r) => r.body?.messages ?? [])),
  };
}

export function modelsJson(baseUrl) {
  return JSON.stringify({
    providers: {
      e2e: {
        baseUrl,
        api: "openai-completions",
        apiKey: "e2e-fake-key",
        models: [{ id: "e2e-model", name: "E2E Model", reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
      },
    },
  }, null, 2);
}
