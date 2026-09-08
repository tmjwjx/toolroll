/**
 * Toolroll 统一类型与适配器接口。
 * 所有服务商适配器实现 Adapter 接口;Service 只依赖本包的接口,
 * 接新服务商 = 新增一个 adapters 子包,核心代码不动。
 */

/** JSON Schema 裸对象(MVP 不引 ajv,Service 做轻校验) */
export type JsonSchema = Record<string, unknown>;

/** 适配器执行上下文:由 Service 提供 */
export interface AdapterCtx {
  /** 解密后的服务商 API key(不落日志) */
  providerKey: string;
  /** 服务商 API base url,可覆盖(测试 mock 用) */
  baseUrl?: string;
  /** 请求追踪 id */
  requestId: string;
}

/** 适配器产出的上游 HTTP 请求 */
export interface UpstreamRequest {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
  /** 上游超时毫秒数 */
  timeoutMs: number;
}

/** 上游原始响应 */
export interface UpstreamResponse {
  status: number;
  body: unknown;
}

/** 适配器内部抛出的结构化错误(mapError 的输入) */
export type AdapterError =
  | { kind: "invalid_input"; message: string; issues?: unknown }
  | { kind: "http"; status: number; body?: unknown }
  | { kind: "timeout"; message?: string }
  | { kind: "network"; message: string };

/** 统一错误码(对外) */
export type UnifiedErrorCode =
  | "invalid_key"
  | "insufficient_balance"
  | "invalid_input"
  | "provider_error"
  | "provider_timeout"
  | "provider_unavailable"
  | "internal";

/** 统一错误体 */
export interface UnifiedError {
  code: UnifiedErrorCode;
  message: string;
  upstream_status?: number;
}

/** 计费声明:unit=request 时 cost 为每次扣的 credit 数 */
export interface Pricing {
  unit: "request" | "credit";
  /** 本次调用的 cost,单位 credit(1 credit = ¥0.01) */
  cost: number;
}

/** 单个 action 定义:一个服务商可有多个 action */
export interface ActionDef {
  /** 统一入参 JSON Schema(同时用于校验、CLI 与未来 MCP 的 tool 定义) */
  input: JsonSchema;
  pricing: Pricing;
  /** 统一入参 → 上游请求 */
  transform(input: unknown, ctx: AdapterCtx): UpstreamRequest;
  /** 上游响应 → 统一 data(200 之外抛 AdapterError);支持 async */
  parse(upstream: UpstreamResponse, ctx: AdapterCtx): unknown | Promise<unknown>;
  /** 内部错误 → 统一错误 */
  mapError(err: unknown): UnifiedError;
}

/** 服务商适配器 */
export interface Adapter {
  provider: string;
  actions: Record<string, ActionDef>;
}

/** 统一成功响应信封 */
export interface UnifiedSuccess<T = unknown> {
  ok: true;
  data: T;
  meta: {
    provider: string;
    action: string;
    credits_charged: number;
    latency_ms: number;
    request_id: string;
  };
}

/** 统一失败响应信封 */
export interface UnifiedFailure {
  ok: false;
  error: UnifiedError;
}
