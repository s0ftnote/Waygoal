// A tiny OpenAI-compatible chat/completions server with controllable output.
// Pi's openai-completions provider streams SSE from `${baseUrl}/chat/completions`.
import { createServer } from "node:http";
import { once } from "node:events";

export async function startFakeModel({ reply = "E2E reply" } = {}) {
  const requests = [];
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
      const text = `${reply}: ${userText.slice(0, 60)}`;
      const id = `chatcmpl-e2e-${requests.length}`;
      const chunk = (delta, finish = null, usage) => `data: ${JSON.stringify({
        id, object: "chat.completion.chunk", created: 0, model: parsed?.model ?? "e2e-model",
        choices: [{ index: 0, delta, finish_reason: finish }], ...(usage ? { usage } : {}),
      })}\n\n`;
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
      res.write(chunk({ role: "assistant", content: "" }));
      res.write(chunk({ content: text }));
      res.write(chunk({}, "stop", { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }));
      res.write("data: [DONE]\n\n");
      res.end();
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  return {
    baseUrl,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
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
