/**
 * E2E 冒烟(spec 11 阶段1):
 *  1. mock Tavily 全链路:开户 → 发key → 充值 → /v1/tavily/search → 断言扣费与用量
 *  2. 真实 Tavily(可选):本机存在 TAVILY_API_KEY(或 ~/.tavily/config.json)时跑真实搜索
 */
import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { startMockTavily } from "./mock-tavily.mjs";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const BASE = "http://localhost:7100";
const ADMIN_TOKEN = "e2e-admin-token";
const MASTER_KEY = "e2e-master-key";
const DB_URL = process.env.E2E_DATABASE_URL ?? "postgres://postgres:toolroll@localhost:5433/toolroll";

let passed = 0;
function assert(cond, label) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    console.error(`  ✗ ${label}`);
    process.exitCode = 1;
  }
}

function findTavilyKey() {
  if (process.env.TAVILY_API_KEY) return process.env.TAVILY_API_KEY;
  const cfg = path.join(homedir(), ".tavily", "config.json");
  if (existsSync(cfg)) {
    try {
      const j = JSON.parse(readFileSync(cfg, "utf8"));
      for (const v of Object.values(j)) {
        if (typeof v === "string" && v.startsWith("tvly-")) return v;
      }
    } catch { /* ignore */ }
  }
  return undefined;
}

async function waitReady(url, tries = 50) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch { /* not ready */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

async function main() {
  const procs = [];
  const cleanup = () => procs.forEach((p) => p.kill());
  process.on("exit", cleanup);

  // 1. mock Tavily + service
  await startMockTavily(7199);
  console.log("e2e: mock tavily on :7199");
  const svc = spawn("pnpm", ["--filter", "@toolroll/service", "exec", "tsx", "src/index.ts"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: "7100",
      DATABASE_URL: DB_URL,
      ADMIN_TOKEN,
      MASTER_KEY,
      TAVILY_API_KEY: "mock-tvly-e2e",
      TAVILY_BASE_URL: "http://localhost:7199",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  svc.stdout.on("data", (d) => process.stdout.write(`[svc] ${d}`));
  svc.stderr.on("data", (d) => process.stderr.write(`[svc!] ${d}`));
  procs.push(svc);

  if (!(await waitReady(`${BASE}/health`))) {
    console.error("e2e: service failed to start");
    process.exit(1);
  }
  console.log("e2e: service ready on :7100");

  const admin = { Authorization: `Bearer ${ADMIN_TOKEN}`, "Content-Type": "application/json" };

  // 2. 开户 / 发 key / 充值
  const u = await (await fetch(`${BASE}/admin/users`, { method: "POST", headers: admin, body: JSON.stringify({ name: "e2e" }) })).json();
  assert(u.ok && u.data.user_id > 0, "admin: create user");
  const k = await (await fetch(`${BASE}/admin/keys`, { method: "POST", headers: admin, body: JSON.stringify({ user_id: u.data.user_id, name: "e2e-key" }) })).json();
  assert(k.ok && k.data.platform_key.startsWith("tr-"), "admin: issue platform key (tr-*)");
  const platformKey = k.data.platform_key;
  const rc = await (await fetch(`${BASE}/admin/recharge`, { method: "POST", headers: admin, body: JSON.stringify({ user_id: u.data.user_id, credits: 100, note: "e2e" }) })).json();
  assert(rc.ok && rc.data.balance_credits === 100, "admin: recharge 100 credits");

  const gwHeaders = { Authorization: `Bearer ${platformKey}`, "Content-Type": "application/json" };

  // 3. 网关全链路(mock)
  const s = await (await fetch(`${BASE}/v1/tavily/search`, {
    method: "POST",
    headers: gwHeaders,
    body: JSON.stringify({ query: "toolroll smoke test", max_results: 2 }),
  })).json();
  assert(s.ok === true, "gateway: /v1/tavily/search ok:true (mock)");
  assert(Array.isArray(s.data?.results) && s.data.results.length === 2, "gateway: returns 2 mock results");
  assert(s.meta?.credits_charged === 1 && s.meta?.provider === "tavily", "gateway: meta credits/provider");
  assert(typeof s.meta?.latency_ms === "number", "gateway: meta latency recorded");

  // 4. 错误路径:错误 key / 未知 provider / 余额不足
  const bad = await fetch(`${BASE}/v1/tavily/search`, { method: "POST", headers: { Authorization: "Bearer tr-wrong", "Content-Type": "application/json" }, body: "{}" });
  assert(bad.status === 401, "gateway: wrong key → 401");
  const unknown = await (await fetch(`${BASE}/v1/nope/action`, { method: "POST", headers: gwHeaders, body: "{}" })).json();
  assert(unknown.ok === false && unknown.error.code === "invalid_input", "gateway: unknown provider → invalid_input");
  const noquery = await (await fetch(`${BASE}/v1/tavily/search`, { method: "POST", headers: gwHeaders, body: "{}" })).json();
  assert(noquery.ok === false && noquery.error.code === "invalid_input", "gateway: missing query → invalid_input");
  const drained = await (await fetch(`${BASE}/admin/usage?days=1`, { headers: admin })).json();
  assert(drained.ok && drained.data.length > 0, "admin: usage records written");

  // 5. 余额不足:充值 0 的另一个用户
  const u2 = await (await fetch(`${BASE}/admin/users`, { method: "POST", headers: admin, body: JSON.stringify({ name: "e2e-poor" }) })).json();
  const k2 = await (await fetch(`${BASE}/admin/keys`, { method: "POST", headers: admin, body: JSON.stringify({ user_id: u2.data.user_id }) })).json();
  const poor = await (await fetch(`${BASE}/v1/tavily/search`, { method: "POST", headers: { Authorization: `Bearer ${k2.data.platform_key}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: "x" }) })).json();
  assert(poor.ok === false && poor.error.code === "insufficient_balance", "gateway: zero balance → insufficient_balance(不转发)");

  // 6. 真实 Tavily(可选)
  const realKey = findTavilyKey();
  if (realKey) {
    console.log("e2e: real tavily key found, running live smoke...");
    // 用真实 key 覆盖 provider_keys(插入新 active 记录,网关取最新一条)——通过专用 service 实例太重,
    // 这里直接对 mock service 换 key:先 revoke 旧 provider key 不可行(无 API),
    // 改为:插入真实 key 需要真实 base url,故单独起一个 service 实例指向 api.tavily.com
    const svc2 = spawn("pnpm", ["--filter", "@toolroll/service", "exec", "tsx", "src/index.ts"], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: "7101",
        DATABASE_URL: DB_URL,
        ADMIN_TOKEN,
        MASTER_KEY,
        TAVILY_API_KEY: realKey,
      },
      stdio: ["ignore", "ignore", "ignore"],
    });
    procs.push(svc2);
    if (await waitReady("http://localhost:7101/health")) {
      const k3 = await (await fetch("http://localhost:7101/admin/keys", { method: "POST", headers: admin, body: JSON.stringify({ user_id: u.data.user_id }) })).json();
      await (await fetch("http://localhost:7101/admin/recharge", { method: "POST", headers: admin, body: JSON.stringify({ user_id: u.data.user_id, credits: 10 }) })).json();
      const live = await (await fetch("http://localhost:7101/v1/tavily/search", {
        method: "POST",
        headers: { Authorization: `Bearer ${k3.data.platform_key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: "what is toolroll", max_results: 2 }),
      })).json();
      assert(live.ok === true && Array.isArray(live.data?.results) && live.data.results.length > 0, "LIVE: real tavily search returned results");
      if (live.ok) {
        console.log(`  (live sample: "${live.data.results[0]?.title}" — credits ${live.meta.credits_charged}, ${live.meta.latency_ms}ms)`);
      }
    } else {
      console.error("  (live service on :7101 failed to start, skipped)");
    }
  } else {
    console.log("e2e: no tavily key found, live smoke skipped");
  }

  console.log(`\ne2e done: ${passed} checks passed${process.exitCode ? " (with failures)" : ""}`);
  process.exit(process.exitCode ?? 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
