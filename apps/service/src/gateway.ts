import { Hono } from "hono";
import type { AdapterCtx, AdapterError, UnifiedError } from "@toolroll/core";
import type { Db } from "./db/client.js";
import { Billing, InsufficientBalanceError } from "./billing.js";
import { decryptProviderKey } from "./crypto.js";
import { makeKeyAuth, type GatewayAuth } from "./auth.js";
import { respondError } from "./errors.js";
import { registry } from "./registry.js";

/** 统一网关:POST /v1/:provider/:action(spec 5.2 数据流) */
export function makeGateway(db: Db, masterKey: string, defaultBaseUrl?: string) {
  const billing = new Billing(db);
  const app = new Hono<{ Variables: { auth: GatewayAuth } }>();

  app.use("*", makeKeyAuth(db));

  app.post("/:provider/:action", async (c) => {
    const provider = c.req.param("provider");
    const action = c.req.param("action");
    const requestId = crypto.randomUUID();
    const auth = c.get("auth");

    const adapter = registry.get(provider);
    const def = adapter?.actions[action];
    if (!adapter || !def) {
      return respondError(c, {
        code: "invalid_input",
        message: `unknown provider/action: ${provider}/${action}`,
      });
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }

    // 取服务商 key(该 provider 最新 active 一条,解密;不落日志)
    const keyRow = await db.query<{ encrypted_key: string }>(
      `SELECT encrypted_key FROM provider_keys
       WHERE provider = $1 AND status = 'active'
       ORDER BY id DESC LIMIT 1`,
      [provider],
    );
    if (keyRow.rows.length === 0) {
      return respondError(c, {
        code: "provider_unavailable",
        message: `no active provider key configured for ${provider}`,
      });
    }
    const providerKey = decryptProviderKey(masterKey, keyRow.rows[0].encrypted_key);

    // 余额预检(粗检):不足直接拒绝,不转发
    try {
      await billing.precheck(auth.userId, def.pricing.cost);
    } catch (e) {
      if (e instanceof InsufficientBalanceError) {
        return respondError(c, { code: "insufficient_balance", message: e.message });
      }
      throw e;
    }

    const ctx: AdapterCtx = { providerKey, baseUrl: defaultBaseUrl, requestId };
    const startedAt = Date.now();

    try {
      const req = def.transform(body, ctx); // 入参不合法在此抛 invalid_input
      const upstreamRes = await fetch(req.url, {
        method: req.method ?? "POST",
        headers: req.headers,
        body: req.body === undefined ? undefined : JSON.stringify(req.body),
        signal: AbortSignal.timeout(req.timeoutMs),
      });
      const upstreamBody: unknown = await upstreamRes.json().catch(() => null);
      const data = await def.parse({ status: upstreamRes.status, body: upstreamBody }, ctx);
      const latencyMs = Date.now() - startedAt;

      // 扣费 + 记账(同一事务);扣费失败(并发下余额不足)按 402 返回
      await billing.settle({
        userId: auth.userId,
        apiKeyId: auth.apiKeyId,
        provider,
        action,
        credits: def.pricing.cost,
        status: "success",
        upstreamStatus: upstreamRes.status,
        latencyMs,
      });

      return c.json({
        ok: true as const,
        data,
        meta: {
          provider,
          action,
          credits_charged: def.pricing.cost,
          latency_ms: latencyMs,
          request_id: requestId,
        },
      });
    } catch (err) {
      const latencyMs = Date.now() - startedAt;

      if (err instanceof InsufficientBalanceError) {
        return respondError(c, { code: "insufficient_balance", message: err.message });
      }

      const adapterErr = normalizeAdapterError(err);
      const unified = adapterErr ? def.mapError(adapterErr) : ({
        code: "internal",
        message: err instanceof Error ? err.message : "internal error",
      } satisfies UnifiedError);
      const upstreamStatus = adapterErr?.kind === "http" ? adapterErr.status : undefined;

      // 失败也记账(credits=0,不扣费);记录失败不影响错误响应
      await billing
        .settle({
          userId: auth.userId,
          apiKeyId: auth.apiKeyId,
          provider,
          action,
          credits: 0,
          status: "error",
          errorCode: unified.code,
          upstreamStatus,
          latencyMs,
        })
        .catch(() => {});

      return respondError(c, unified);
    }
  });

  return app;
}

/** fetch 层异常(超时/网络)归一为 AdapterError;已结构化的直接透传 */
function normalizeAdapterError(err: unknown): AdapterError | null {
  if (typeof err === "object" && err !== null && "kind" in err) {
    const kinds = ["invalid_input", "http", "timeout", "network"];
    if (kinds.includes((err as AdapterError).kind)) return err as AdapterError;
  }
  if (err instanceof Error) {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      return { kind: "timeout", message: err.message };
    }
    // undici 网络错误:TypeError: fetch failed(原因在 cause)
    if (err instanceof TypeError && /fetch/i.test(err.message)) {
      const cause = err.cause instanceof Error ? err.cause.message : err.message;
      return { kind: "network", message: cause };
    }
  }
  return null;
}
