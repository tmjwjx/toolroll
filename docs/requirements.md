# Toolroll 需求与设计文档

- 日期:2026-09-07
- 状态:待用户确认
- 变更方式:设计确认后如需修改,直接改本文件并 commit,保持文档与实现同步

## 1. 背景与定位

Agent 开发者要接工具类 API(搜索、抓取、企业信息、金融数据等),需要分别注册多家服务商、管理一堆 key、海外服务还需要外币卡支付、国内访问网络不稳。

**Toolroll 定位**:面向国内开发者的工具类 API 聚合中转平台。

- 用户只持有**一个平台 key**(Toolroll 签发),即可调用所有已接入的服务商
- 人民币计费(预充值余额),国内网络可达
- 各服务商真实 key 由平台托管加密存储,用户不可见

**服务商接入原则**:不设类别、数量限制,来者不拒,按需求随时接入。

**不做的事**(保持定位清晰):

- 不做 LLM 聚合(OpenRouter 主场)
- MVP 期不做公测运营、不做用户自助注册

## 2. 目标用户与使用场景

目标用户:国内 agent 开发者(开发期为自用 + 小范围试用)。

| # | 场景 | 调用方式 |
|---|------|---------|
| S1 | 开发者在终端快速查询 | `toolroll search "..."` |
| S2 | agent 程序把 CLI 当工具执行 | agent spawn `toolroll ... --json` |
| S3 | 程序直接 HTTP 调用 | `POST https://<host>/v1/tavily/search` + Bearer 平台 key |

S1/S2/S3 共用同一个 Service,CLI 只是薄壳。

## 3. 功能需求

| # | 需求 | 说明 |
|---|------|------|
| FR1 | 平台 key 管理 | 签发、吊销、列出(管理 API;MVP 期手动开户,无自助注册) |
| FR2 | 统一调用端点 | `POST /v1/{provider}/{action}`,Bearer 平台 key 鉴权 |
| FR3 | 服务商适配器 | 统一入参 → 服务商原生请求;服务商响应 → 统一格式;计费单位声明 |
| FR4 | 计量与计费 | 每次调用记录用量;预充值余额按 credits 扣;余额不足拒绝且不转发 |
| FR5 | 服务商 key 托管 | 加密存储(AES-256-GCM),内存中解密使用 |
| FR6 | 管理 API | 开户/发 key/充值(手动登记)/查用量 |
| FR7 | CLI | `toolroll login / search / scrape / usage`,支持 `--json` |
| FR8 | 用量查询 | API + CLI,按天/按服务商汇总 |

**首批服务商**(测试期免费额度足够):

| 类别 | 服务商 | 免费额度 | 阶段 |
|------|--------|---------|------|
| 搜索 | Tavily | 1000 credits/月 | 阶段 1(MVP 首家) |
| 抓取 | Firecrawl | 1000 credits/月 | 阶段 3 |
| 股票 | Tushare Pro | 免费积分制 | 阶段 3 |
| 股票(海外) | Alpha Vantage | 25 次/天 | 备选 |
| 企业信息 | 企查查开放平台 | 无免费层,小额充值 | 阶段 3(可选) |
| 社媒数据 | 第三方数据服务商(见下方候选清单) | 见下方 | 阶段 3(可选) |
| 天气 | OpenWeatherMap | 免费层大 | 练手样本(可选) |

**抖音/社媒数据 API 候选清单**(阶段 3 接入,2026-09 已核实;国内抖音与海外 TikTok 的覆盖度以各家文档为准):

| 服务商 | 覆盖 | 免费额度 |
|--------|------|---------|
| 极致了数据 | 抖音:视频/评论/粉丝画像/直播等 17 类 | 新用户免费试用额度 |
| EchoTik | TikTok:达人/视频/直播/商品/榜单 | 注册送 100 次调用 |
| ScrapeCreators | 多平台社媒(含 TikTok) | 100 credits |
| SociaVault | 多平台社媒(含 TikTok),有 MCP | 50 credits |
| EnsembleData | TikTok 深度覆盖(~20 个 endpoint) | 试用额度 |
| Social Fetch | 多平台统一 schema(含 TikTok Shop/广告/转写) | 100 credits,免信用卡 |
| Apify(TikTok Scraper 等 Actor) | 可配置抓取,海量 Actor 市场 | $5/月平台额度 |

**接入顺序**(按场景与体量,2026-09 核定):① 极致了数据(唯一直接覆盖国内抖音,API 形态最简)→ ② EchoTik(海外 TikTok 首选,51–200 员工、天使轮 $200 万+)→ ③ EnsembleData(TikTok 备选,endpoint 最全)→ ④ Apify(通用兜底,计费模型复杂故最后)。

## 4. 非功能需求

- **延迟**:中转层附加延迟 P95 < 50ms(不含服务商自身响应时间)
- **可靠性**:服务商故障/超时返回统一错误码,服务不崩溃;单服务商故障不影响其他
- **安全**:平台 key 只存 SHA-256 哈希;HTTPS;服务商 key AES-256-GCM 加密落库;日志不记录请求/响应体内容(只记元数据)
- **合规**:首批仅接官方 API;Tavily(已被 Nebius 收购,政策摇摆)、Firecrawl 的 ToS 尽调在对外提供前完成
- **部署**:香港节点(免备案、国内延迟 50–80ms、出海链路稳),Docker 单容器 + PostgreSQL

## 5. 系统架构

### 5.1 Monorepo 结构(pnpm)

```
toolroll/
├── apps/
│   ├── service/        # 中转服务(Hono,HTTP)
│   └── cli/            # toolroll CLI(commander,npm 包)
├── packages/
│   ├── core/           # 公共类型:统一请求/响应、计费、错误码、Adapter 接口
│   └── adapters/       # 每家服务商一个子包(tavily/ firecrawl/ ...)
└── docs/               # 需求文档、架构图、阶段报告
```

### 5.2 一次调用的数据流

```
CLI / HTTP 客户端
   │  Authorization: Bearer tr-xxxx(平台 key)
   ▼
Service: POST /v1/{provider}/{action}
   1. 鉴权:验平台 key → 定位用户
   2. 预检:余额不足 → 直接拒绝(不转发)
   3. 路由:按 URL 段找到对应适配器
   4. 适配器:统一入参 → 服务商请求(带托管的服务商 key)
   5. 转发 → 服务商响应 → 适配器转统一格式
   6. 记账:异步写用量记录并扣余额
   7. 返回统一格式 JSON
```

## 6. 数据模型(PostgreSQL)

| 表 | 字段 | 说明 |
|----|------|------|
| `users` | id, name, note, created_at | MVP 期手动创建 |
| `api_keys` | id, user_id, key_hash, name, status, last_used_at, created_at | 平台 key 只存哈希;status: active/revoked |
| `balances` | user_id (PK), credits, updated_at | 余额,numeric |
| `recharge_records` | id, user_id, credits, note, created_at | 充值登记(手动) |
| `usage_records` | id, user_id, api_key_id, provider, action, credits, status, upstream_status, latency_ms, created_at | 用量明细,失败也记录 |
| `provider_keys` | id, provider, encrypted_key, status, created_at | 服务商 key 池,加密存储 |

索引:`api_keys(key_hash)`、`usage_records(user_id, created_at)`、`usage_records(provider, created_at)`。

计费一致性:MVP 采用「预检(粗)→ 调用 → 按定价扣费(与写用量同事务)」。不做复杂对账,余额允许极小并发误差,自用阶段可接受。

## 7. 适配器接口(packages/core)

```ts
interface Adapter {
  provider: string;
  actions: Record<string, ActionDef>;
}

interface ActionDef {
  input: JsonSchema;                     // 统一入参 schema
  pricing: { unit: "request" | "credit"; cost: number };
  transform(input: unknown, ctx: AdapterCtx): UpstreamRequest;
  parse(upstream: UpstreamResponse): unknown;   // 服务商响应 → 统一 data
  mapError(err: unknown): UnifiedError;
}
```

- 统一成功响应:`{ ok: true, data, meta: { provider, action, credits_charged, latency_ms } }`
- 统一错误响应:`{ ok: false, error: { code, message, upstream_status? } }`
- 统一错误码:`invalid_key` / `insufficient_balance` / `invalid_input` / `provider_error` / `provider_timeout` / `provider_unavailable` / `internal`
- 接新服务商 = 在 `packages/adapters/` 加一个子包,实现 `Adapter` 接口并注册;不动核心代码

## 8. 计费

- 内部记账单位:**credit,1 credit = ¥0.01**
- 定价:每个 action 在适配器里声明 `pricing`,MVP 期加价系数 = 1.0(按服务商成本价自用),对外时再调系数
- 规则:成功扣费;参数错误不扣;服务商 5xx/超时不扣;余额预检不足直接 `402 insufficient_balance`

## 9. CLI(apps/cli)

| 命令 | 作用 |
|------|------|
| `toolroll login` | 交互输入平台 key,存 `~/.config/toolroll/config.json`(权限 0600) |
| `toolroll search "query"` | 搜索(默认 Tavily),`--json` 输出结构化(agent 用) |
| `toolroll scrape <url>` | 网页抓取(Firecrawl) |
| `toolroll usage [--days 7]` | 用量汇总 |

CLI 不含业务逻辑,全部转发 Service;网络失败给出可读错误与重试提示。

## 10. 错误处理与日志

- 上游超时:搜索类 10s、抓取类 30s → `provider_timeout`
- 上游 5xx → `provider_error`(透传 upstream_status)
- 平台侧不做主动限流(靠余额约束),列入后续待办
- 结构化日志:请求 id、user_id、provider、action、credits、latency、状态码;**不记请求/响应体**

## 11. 测试策略

| 阶段 | 测试 |
|------|------|
| 阶段 1(MVP) | 1 条 E2E 冒烟:真实平台 key → Tavily → 真实结果;鉴权/预检路径手动验证 |
| 阶段 2(重构) | 先给鉴权、预检、扣费补单元测试(重构安全网);适配器用 mock upstream 测转换与错误映射 |
| 阶段 3 | 每家适配器 contract test(mock 上游);计费回归测试 |

## 12. 阶段计划与产出物

| 阶段 | 内容 | 产出物 |
|------|------|--------|
| 0 需求讨论 | 需求澄清 + 设计定稿 | 本文档 |
| 1 MVP 打通(3–5 天) | 立接口边界 → Service 骨架 + Tavily 适配器端到端(硬编码最小实现)→ 一条 E2E 冒烟 | `docs/reports/mvp-report.md`(含验证证据) |
| 2 重构规范化(2–3 天) | 补单测 → monorepo 目录重整 → DB migration 规范 → 结构化日志/配置管理 | 动手前:`docs/architecture.md`(完整架构图,开发中持续完善) |
| 3 功能填充(1–2 周) | 逐家加适配器(Firecrawl/Tushare/企查查…)→ 计费闭环 → CLI 完整 → 管理 API | 正常 git 记录 |
| 4 部署 | 香港服务器 + Docker + 域名 HTTPS | 暂不规划,开发完再议 |

Git 约定:正常 commit 留档,不打 tag;commit message 中英双语。

## 13. 风险与待办

| 风险/待办 | 处理 |
|-----------|------|
| 企查查无免费层 | 阶段 3 再接,小额充值验证 |
| MVP 不做:平台限流、多 key 池轮询、Web 控制台、自助注册 | 记入后续迭代,不阻塞 MVP |
