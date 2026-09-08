# 阶段 1 MVP 报告

- 日期:2026-09-08
- 结论:**通过**。全链路(平台 key 鉴权 → 余额预检 → 适配器转发 → 扣费记账 → 统一响应)已打通,mock 与真实 Tavily 双模式 E2E 冒烟 13/13 通过。
- 对应 commit:`d1b07fb`

## 交付内容

| 模块 | 位置 | 说明 |
|------|------|------|
| 接口边界 | `packages/core` | Adapter/ActionDef 接口、统一错误码、统一响应信封(spec 7 全量落地) |
| Tavily 适配器 | `packages/adapters/tavily` | 首家服务商:search action,入参 schema 参照官方 API |
| 中转 Service | `apps/service` | Hono + Node:网关 `/v1/:provider/:action`、管理 API `/admin/*`、`/health` |
| 数据模型 | `apps/service/src/db/schema.sql` | spec 6 的 6 张表,启动时幂等建表 |
| 平台 key | `apps/service/src/crypto.ts` | `tr-*` 格式,仅存 SHA-256;服务商 key AES-256-GCM 落库 |
| 计费 | `apps/service/src/billing.ts` | 预检(不足不转发)→ 事务内条件扣费 + 用量记录;失败不扣费 |
| E2E 冒烟 | `apps/service/test/e2e.mjs` | mock Tavily 全链路 + 真实 Tavily live 冒烟 |

## 验证证据(2026-09-08 实测)

```
13 checks passed, 0 failed
✓ admin: create user / issue platform key (tr-*) / recharge 100 credits
✓ gateway: /v1/tavily/search ok:true (mock) — 2 results, credits_charged=1
✓ gateway: wrong key → 401;unknown provider → invalid_input;missing query → invalid_input
✓ gateway: zero balance → insufficient_balance(不转发)
✓ LIVE: real tavily search returned results
  (live sample: "Legacy Tool Roll - Heavy-Duty Canvas Tool Roll Bag", 854ms, 扣 1 credit)
```

运行方式:`pnpm e2e`(需先 `docker start toolroll-pg`,PG 容器映射 5433)。

## 已知限制(留给阶段 2/3)

1. 入参校验只在 transform 内做 required 检查,未接 JSON Schema 校验器
2. 无单元测试(当前仅 E2E);阶段 2 先给鉴权/计费补单测再重构
3. 管理 API 鉴权用静态 ADMIN_TOKEN,无操作审计
4. `data` 为服务商原始 JSON 透传,各家的响应归一化在阶段 3 做
5. 记账失败被静默吞掉(`.catch(() => {})`),对账与补偿在阶段 3 完善
6. 服务商 key 轮换:env 种入时自动切换(旧 key 置 inactive),无界面管理
7. 无平台限流(按 spec,MVP 期靠余额约束)
