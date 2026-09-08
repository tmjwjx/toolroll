/** 本地 mock Tavily:POST /search → 固定结果(不依赖外部网络) */
import { createServer } from "node:http";

export function startMockTavily(port = 7199) {
  const server = createServer((req, res) => {
    if (req.method === "POST" && req.url === "/search") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const auth = req.headers.authorization ?? "";
        if (!auth.startsWith("Bearer mock-tvly-")) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ detail: "invalid api key" }));
          return;
        }
        const input = JSON.parse(body || "{}");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            query: input.query,
            answer: `mock answer for: ${input.query}`,
            results: [
              { title: "Mock Result 1", url: "https://example.com/1", content: "mock content 1", score: 0.98 },
              { title: "Mock Result 2", url: "https://example.com/2", content: "mock content 2", score: 0.91 },
            ],
          }),
        );
      });
      return;
    }
    res.writeHead(404).end();
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
