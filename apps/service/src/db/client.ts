import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

/** MVP 直接用裸 SQL + pg Pool,阶段 2 再定 migration 方案 */

export type QueryResultRow = pg.QueryResultRow;

export class Db {
  private pool: pg.Pool;

  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  }

  query<T extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<pg.QueryResult<T>> {
    return this.pool.query<T>(text, params);
  }

  /** 事务:回调内拿到复用同一连接的 client */
  async withTx<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(new TxClient(client));
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async initSchema(): Promise<void> {
    const schemaPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "schema.sql",
    );
    const sql = readFileSync(schemaPath, "utf8");
    await this.pool.query(sql);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export class TxClient {
  // eslint-disable-next-line no-useless-constructor
  constructor(private client: pg.PoolClient) {}

  query<T extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<pg.QueryResult<T>> {
    return this.client.query<T>(text, params);
  }
}
