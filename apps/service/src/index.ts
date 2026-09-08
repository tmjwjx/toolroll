import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { loadConfig } from "./config.js";
import { Db } from "./db/client.js";
import { makeAdmin } from "./admin.js";
import { makeGateway } from "./gateway.js";
import { encryptProviderKey } from "./crypto.js";

const config = loadConfig();
const db = new Db(config.databaseUrl);

await db.initSchema();

// 启动时种入服务商 key:env 提供 TAVILY_API_KEY 且表中无相同密文时插入,并把旧 key 置为 inactive(支持轮换)
if (config.tavilyApiKey) {
  const encrypted = encryptProviderKey(config.masterKey, config.tavilyApiKey);
  const same = await db.query(
    `SELECT id FROM provider_keys WHERE provider = 'tavily' AND encrypted_key = $1`,
    [encrypted],
  );
  if (same.rowCount === 0) {
    await db.withTx(async (tx) => {
      await tx.query(
        `UPDATE provider_keys SET status = 'inactive' WHERE provider = 'tavily' AND status = 'active'`,
      );
      await tx.query(
        `INSERT INTO provider_keys (provider, encrypted_key) VALUES ('tavily', $1)`,
        [encrypted],
      );
    });
    console.log("[toolroll] seeded tavily provider key from env");
  }
}

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true, service: "toolroll", version: "0.1.0" }));

app.route("/admin", makeAdmin(db));
app.route("/v1", makeGateway(db, config.masterKey, config.tavilyBaseUrl));

serve({ fetch: app.fetch, port: config.port }, () => {
  console.log(`[toolroll] service listening on :${config.port}`);
});
