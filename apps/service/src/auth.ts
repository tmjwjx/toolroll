import type { Context, Next } from "hono";
import type { Db } from "./db/client.js";

/** 平台 key 鉴权:Bearer tr-xxx → SHA-256 → api_keys(active)→ user + 余额 */
export interface GatewayAuth {
  userId: number;
  apiKeyId: number;
  balanceCredits: number;
}

export function makeKeyAuth(db: Db) {
  return async (c: Context, next: Next) => {
    const header = c.req.header("Authorization") ?? "";
    const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!bearer) {
      return c.json({ ok: false, error: { code: "invalid_key", message: "missing bearer token" } }, 401);
    }
    const hash = (await import("./crypto.js")).hashPlatformKey(bearer);
    const row = await db.query<{
      user_id: number;
      id: number;
      balance_credits: string;
      status: string;
    }>(
      `SELECT k.id, k.user_id, k.status, b.credits AS balance_credits
       FROM api_keys k
       LEFT JOIN balances b ON b.user_id = k.user_id
       WHERE k.key_hash = $1
       LIMIT 1`,
      [hash],
    );
    const key = row.rows[0];
    if (!key || key.status !== "active") {
      return c.json({ ok: false, error: { code: "invalid_key", message: "invalid or revoked key" } }, 401);
    }
    c.set("auth", {
      userId: key.user_id,
      apiKeyId: key.id,
      balanceCredits: Number(key.balance_credits ?? 0),
    } satisfies GatewayAuth);
    await db.query(`UPDATE api_keys SET last_used_at = now() WHERE id = $1`, [key.id]);
    await next();
  };
}

/** 管理 API 鉴权:Bearer ADMIN_TOKEN(静态配置,MVP 足够) */
export function makeAdminAuth(adminToken: string) {
  return async (c: Context, next: Next) => {
    const header = c.req.header("Authorization") ?? "";
    const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (bearer !== adminToken) {
      return c.json({ ok: false, error: { code: "invalid_key", message: "admin token required" } }, 401);
    }
    await next();
  };
}
