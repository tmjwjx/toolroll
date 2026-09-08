import type { Db } from "./db/client.js";

/** 计费与记账(spec 6/8):
 *  - 预检:余额 < cost 直接拒绝,不转发
 *  - 结算:扣余额 + 写用量记录,同一事务
 *  - 失败也记用量,但不扣费(credits=0)
 */

export interface SettleInput {
  userId: number;
  apiKeyId: number;
  provider: string;
  action: string;
  credits: number; // 0 表示失败不计费
  status: "success" | "error";
  errorCode?: string;
  upstreamStatus?: number;
  latencyMs: number;
}

export class InsufficientBalanceError extends Error {
  readonly need: number;
  readonly have: number;
  constructor(need: number, have: number) {
    super(`insufficient balance: need ${need}, have ${have}`);
    this.need = need;
    this.have = have;
  }
}

export class Billing {
  constructor(private db: Db) {}

  async precheck(userId: number, cost: number): Promise<number> {
    const r = await this.db.query<{ credits: string }>(
      `SELECT credits FROM balances WHERE user_id = $1`,
      [userId],
    );
    const credits = Number(r.rows[0]?.credits ?? 0);
    if (credits < cost) throw new InsufficientBalanceError(cost, credits);
    return credits;
  }

  async settle(input: SettleInput): Promise<void> {
    await this.db.withTx(async (tx) => {
      if (input.credits > 0) {
        // 条件扣费:余额不足时 UPDATE 影响 0 行 → 回滚报错
        const r = await tx.query<{ user_id: number }>(
          `UPDATE balances
           SET credits = credits - $2, updated_at = now()
           WHERE user_id = $1 AND credits >= $2
           RETURNING user_id`,
          [input.userId, input.credits],
        );
        if (r.rowCount === 0) {
          throw new InsufficientBalanceError(input.credits, 0);
        }
      }
      await tx.query(
        `INSERT INTO usage_records
           (user_id, api_key_id, provider, action, credits, status, error_code, upstream_status, latency_ms)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          input.userId,
          input.apiKeyId,
          input.provider,
          input.action,
          input.credits,
          input.status,
          input.errorCode ?? null,
          input.upstreamStatus ?? null,
          input.latencyMs,
        ],
      );
    });
  }
}
