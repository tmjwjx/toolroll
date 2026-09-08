import type {
  Adapter,
  ActionDef,
  AdapterCtx,
  AdapterError,
  UnifiedError,
} from "@toolroll/core";

/** Tavily /search 入参,参照官方 API 与其官方 MCP tool 定义 */
const searchInput = {
  type: "object",
  properties: {
    query: { type: "string", description: "搜索关键词" },
    max_results: { type: "number", minimum: 1, maximum: 20, default: 5 },
    search_depth: { type: "string", enum: ["basic", "advanced"], default: "basic" },
    topic: { type: "string", enum: ["general", "news"], default: "general" },
    time_range: {
      type: "string",
      enum: ["day", "week", "month", "year"],
      description: "结果时间范围,仅 topic=news 或 general 支持",
    },
  },
  required: ["query"],
  additionalProperties: false,
} as const;

function toAdapterError(err: unknown): UnifiedError {
  const e = err as AdapterError;
  switch (e.kind) {
    case "http": {
      // Tavily 4xx 视为 provider_error(带上游状态码);MVP 不细分
      return {
        code: "provider_error",
        message: `tavily responded ${e.status}`,
        upstream_status: e.status,
      };
    }
    case "timeout":
      return { code: "provider_timeout", message: e.message ?? "tavily timeout" };
    case "network":
      return { code: "provider_unavailable", message: e.message };
    case "invalid_input":
      return { code: "invalid_input", message: e.message, ...(e.issues ? { issues: e.issues } : {}) };
    default:
      return { code: "internal", message: "unknown adapter error" };
  }
}

const search: ActionDef = {
  input: searchInput,
  // 计费:Tavily 官方 basic search = 1 credit;MVP 阶段按成本价 1 credit 记账
  pricing: { unit: "request", cost: 1 },
  transform(input, ctx: AdapterCtx) {
    const i = (input ?? {}) as Record<string, unknown>;
    if (typeof i.query !== "string" || i.query.length === 0) {
      throw { kind: "invalid_input", message: "query is required" } satisfies AdapterError;
    }
    const body: Record<string, unknown> = { query: i.query };
    if (i.max_results !== undefined) body.max_results = i.max_results;
    if (i.search_depth !== undefined) body.search_depth = i.search_depth;
    if (i.topic !== undefined) body.topic = i.topic;
    if (i.time_range !== undefined) body.time_range = i.time_range;
    return {
      url: `${ctx.baseUrl ?? "https://api.tavily.com"}/search`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ctx.providerKey}`,
      },
      body,
      timeoutMs: 10_000,
    };
  },
  async parse(upstream, ctx) {
    if (upstream.status !== 200) {
      throw { kind: "http", status: upstream.status, body: upstream.body } satisfies AdapterError;
    }
    // MVP:data 直接透传 Tavily 原始 JSON;阶段 3 归一化各家格式
    return upstream.body;
  },
  mapError: toAdapterError,
};

export const tavilyAdapter: Adapter = {
  provider: "tavily",
  actions: { search },
};
