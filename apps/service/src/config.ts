/** 服务配置:全部来自环境变量,MVP 不做配置中心 */
export interface Config {
  port: number;
  databaseUrl: string;
  /** 管理 API 的 Bearer token */
  adminToken: string;
  /** 服务商 key 落库加密主密钥(32 字节材料,存 sha256 后用) */
  masterKey: string;
  /** 可选:启动时种入的 Tavily key(也支持直接放 provider_keys 表) */
  tavilyApiKey?: string;
  /** 可选:Tavily base url 覆盖(mock 测试用) */
  tavilyBaseUrl?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = env.DATABASE_URL ?? "postgres://postgres:toolroll@localhost:5433/toolroll";
  const adminToken = env.ADMIN_TOKEN;
  const masterKey = env.MASTER_KEY;
  if (!adminToken) throw new Error("ADMIN_TOKEN is required");
  if (!masterKey) throw new Error("MASTER_KEY is required");
  return {
    port: Number(env.PORT ?? 7100),
    databaseUrl,
    adminToken,
    masterKey,
    tavilyApiKey: env.TAVILY_API_KEY,
    tavilyBaseUrl: env.TAVILY_BASE_URL,
  };
}
