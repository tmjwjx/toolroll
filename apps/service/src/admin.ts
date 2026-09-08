import { Hono } from "hono";
import type { Db } from "./db/client.js";
import { generatePlatformKey, hashPlatformKey } from "./crypto.js";

/** 管理 API(spec FR1/FR6):MVP 手动开户/充值,Bearer ADMIN_TOKEN */
export function makeAdmin(db: Db) {
  const app = new Hono();

  // 开户:建用户 + 0 余额
  app.post("/users", async (c) => {
    const { name, note } = await c.req.json<{ name?: string; note?: string }>();
    if (!name) return c.json({ ok: false, error: { code: "invalid_input", message: "name required" } }, 400);
    const r = await db.query<{ id: number }>(
      `INSERT INTO users (name, note) VALUES ($1, $2) RETURNING id`,
      [name, note ?? null],
    );
    await db.query(`INSERT INTO balances (user_id, credits) VALUES ($1, 0)`, [r.rows[0].id]);
    return c.json({ ok: true as const, data: { user_id: r.rows[0].id, name } });
  });

  // 发平台 key(明文只此一次返回)
  app.post("/keys", async (c) => {
    const { user_id, name } = await c.req.json<{ user_id?: number; name?: string }>();
    if (!user_id) return c.json({ ok: false, error: { code: "invalid_input", message: "user_id required" } }, 400);
    const user = await db.query(`SELECT id FROM users WHERE id = $1`, [user_id]);
    if (user.rowCount === 0) {
      return c.json({ ok: false, error: { code: "invalid_input", message: "user not found" } }, 400);
    }
    const key = generatePlatformKey();
    const r = await db.query<{ id: number }>(
      `INSERT INTO api_keys (user_id, key_hash, name) VALUES ($1, $2, $3) RETURNING id`,
      [user_id, hashPlatformKey(key), name ?? "default"],
    );
    return c.json({ ok: true as const, data: { key_id: r.rows[0].id, platform_key: key } });
  });

  // 充值(手动登记)
  app.post("/recharge", async (c) => {
    const { user_id, credits, note } = await c.req.json<{
      user_id?: number;
      credits?: number;
      note?: string;
    }>();
    if (!user_id || !credits || credits <= 0) {
      return c.json({ ok: false, error: { code: "invalid_input", message: "user_id and positive credits required" } }, 400);
    }
    const data = await db.withTx(async (tx) => {
      await tx.query(`INSERT INTO recharge_records (user_id, credits, note) VALUES ($1, $2, $3)`, [
        user_id,
        credits,
        note ?? null,
      ]);
      const r = await tx.query<{ credits: string }>(
        `UPDATE balances SET credits = credits + $2, updated_at = now()
         WHERE user_id = $1 RETURNING credits`,
        [user_id, credits],
      );
      return { balance_credits: Number(r.rows[0].credits) };
    });
    return c.json({ ok: true as const, data });
  });

  // 平台 key 列表(不含明文)
  app.get("/keys", async (c) => {
    const r = await db.query<{
      id: number;
      user_id: number;
      name: string;
      status: string;
      last_used_at: string | null;
      created_at: string;
    }>(
      `SELECT id, user_id, name, status, last_used_at, created_at FROM api_keys ORDER BY id`,
    );
    return c.json({ ok: true as const, data: r.rows });
  });

  // 吊销 key
  app.post("/keys/:id/revoke", async (c) => {
    const id = Number(c.req.param("id"));
    await db.query(`UPDATE api_keys SET status = 'revoked' WHERE id = $1`, [id]);
    return c.json({ ok: true as const });
  });

  // 用量汇总
  app.get("/usage", async (c) => {
    const days = Number(c.req.query("days") ?? 7);
    const userId = c.req.query("user_id");
    const params: unknown[] = [days];
    let where = `created_at > now() - ($1 || ' days')::interval`;
    if (userId) {
      params.push(Number(userId));
      where += ` AND user_id = $${params.length}`;
    }
    const r = await db.query(
      `SELECT provider, action, status,
              COUNT(*) AS calls,
              COALESCE(SUM(credits), 0) AS credits,
              ROUND(AVG(latency_ms)) AS avg_latency_ms
       FROM usage_records
       WHERE ${where}
       GROUP BY provider, action, status
       ORDER BY provider, action, status`,
      params,
    );
    return c.json({ ok: true as const, data: r.rows });
  });

  return app;
}
