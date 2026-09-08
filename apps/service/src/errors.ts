import type { UnifiedError, UnifiedErrorCode } from "@toolroll/core";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/** 统一错误码 → HTTP 状态码 */
export const HTTP_STATUS: Record<UnifiedErrorCode, ContentfulStatusCode> = {
  invalid_key: 401,
  insufficient_balance: 402,
  invalid_input: 400,
  provider_error: 502,
  provider_timeout: 504,
  provider_unavailable: 503,
  internal: 500,
};

export function failJson(err: UnifiedError) {
  return { ok: false as const, error: err };
}

export function respondError(c: Context, err: UnifiedError) {
  return c.json(failJson(err), HTTP_STATUS[err.code]);
}
