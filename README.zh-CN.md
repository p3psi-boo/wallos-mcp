# Wallos MCP

[English](README.md) | [简体中文](README.zh-CN.md)

基于 TypeScript 和 Cloudflare Workers 的远程 [Model Context Protocol](https://modelcontextprotocol.io/) 服务器，通过 `/mcp` 的 Streamable HTTP 接口管理 [Wallos](https://github.com/ellite/Wallos) 订阅记录。

当前版本完成第一阶段只读工具和第二阶段单条写入。每次部署连接一个 Wallos 账户。

## 工具

| 工具 | 用途 |
| --- | --- |
| `wallos_get_context` | 可用币种、分类、家庭成员、付款方式、时区及提醒通道状态 |
| `wallos_search_subscriptions` | 搜索和筛选订阅，支持快照绑定分页 |
| `wallos_get_subscription` | 订阅详情及后续写入所需的版本摘要 |
| `wallos_list_upcoming_payments` | 指定日期范围内各启用记录的下一次付款 |
| `wallos_summarize_costs` | 全部启用记录的指定月预计费用或月均折算成本 |
| `wallos_create_subscription` | 用业务字段创建一条记录，精确解析引用 |
| `wallos_update_subscription` | 更新普通字段，保留未提供的值 |
| `wallos_set_tracking_state` | 启用或停用 Wallos 跟踪记录 |
| `wallos_set_subscription_reminder` | 保存单条记录的提醒开关和提前天数 |

Resources：`wallos://reference-data`、`wallos://cost-policy`。

操作修改的是 Wallos 记录，不是服务商账户或实际扣款。保存提醒配置不代表通知已经送达。付款列表的覆盖范围为 `next_payment_only`；完整账期展开、永久删除、辅助数据管理和批量写入属于后续阶段。工具集不含管理员设置或自动 Logo 下载。

## 快速开始

使用 Node.js 24；支持的 Node.js 版本见 [`package.json`](package.json)。准备一个已运行的 Wallos 实例和账户 API key。

```bash
git clone https://github.com/p3psi-boo/wallos-mcp.git
cd wallos-mcp
npm ci
cp .dev.vars.example .dev.vars
```

编辑 `.dev.vars`，填写 Wallos 安装根地址、Wallos API key 和独立的 MCP Bearer token。生成 MCP token：

```bash
openssl rand -hex 32
```

启动本地 Worker：

```bash
npm run dev
```

默认端点：`http://localhost:8787/mcp`。在 NixOS 上，`npm run dev` 会选用已安装的兼容 glibc loader 启动 npm 的 workerd 二进制；显式设置的 `MINIFLARE_WORKERD_PATH` 优先。

## 配置

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `WALLOS_BASE_URL` | Wallos 安装根地址，包含安装子目录 | 必填 |
| `WALLOS_API_KEY` | 当前 Wallos 账户的 API key | 必填 |
| `MCP_AUTH_TOKEN` | 独立的客户端 Bearer token，至少 32 字符 | 必填 |
| `TIMEZONE` | 业务日期使用的 IANA 时区 | `UTC` |
| `UPSTREAM_TIMEOUT_MS` | 上游超时，100–60000 毫秒 | `10000` |
| `ALLOW_HTTP_UPSTREAM` | 显式启用开发环境 HTTP 上游连接 | `false` |
| `ALLOWED_ORIGINS` | 逗号分隔的浏览器 Origin 精确白名单 | 空 |

如果 Wallos 安装在 `https://HOST/wallos/`，填写此根地址，而不是 `/api` 下的某个接口。HTTP 上游需要设置 `ALLOW_HTTP_UPSTREAM=true`。

配置的 MCP token 允许调用当前账户的全部 9 个工具。多个账户使用独立部署和 token。账户身份、上游凭据和上游根地址属于服务端配置，不属于工具参数。`payer_member` 指家庭成员，不是 Wallos 登录账户；订阅的网站 URL 则是普通记录字段。

没有 Origin 请求头的桌面和命令行客户端正常连接。浏览器请求的 Origin 必须精确匹配 `ALLOWED_ORIGINS`。`GET /health` 只检查服务存活，不探测 Wallos 连通性。

## 部署到 Cloudflare

1. 在 `wrangler.jsonc` 中设置生产时区和浏览器 Origin，保留现有 Durable Object 绑定和 SQLite migration。
2. 复制 `.env.production.example` 为 `.env.production`，填写三个生产配置值；示例中的 MCP token 要替换为生成的随机 token。
3. 登录并部署：

```bash
npm run check
npx wrangler login
npm run deploy -- --secrets-file .env.production
```

部署命令同时上传代码和 secrets。本地 `.dev.vars` 不会自动发布，生产 secrets 文件已被 Git 忽略。

Worker 需要访问到配置的 Wallos HTTPS 根地址。Durable Object 存储按项目配置建立，不需要另外启动数据库服务器或创建 KV、D1。

在 Wrangler 输出的地址后加 `/mcp`，然后验证部署：

```bash
curl https://HOST/health
MCP_URL=https://HOST/mcp MCP_AUTH_TOKEN=TOKEN npm run smoke
```

后续执行 `npm run deploy` 会保留现有 secrets。单独更新配置可执行 `npx wrangler secret put WALLOS_API_KEY`，也可重新部署 secrets 文件。

## 连接 MCP 客户端

选择 **Streamable HTTP**，填写端点 `https://HOST/mcp`，添加请求头：

```http
Authorization: Bearer TOKEN
```

采用下列配置格式的客户端可以填写：

```json
{
  "mcpServers": {
    "wallos": {
      "url": "https://HOST/mcp",
      "headers": { "Authorization": "Bearer TOKEN" }
    }
  }
}
```

具体配置格式由客户端决定。MCP Inspector 使用相同端点和请求头；浏览器直连时，将其实际 Origin 加入 `ALLOWED_ORIGINS`。

认证使用静态 Bearer token，不含 OAuth 流程。服务支持现代 MCP 请求及无会话的 2025 Streamable HTTP 兼容请求，没有独立 `/sse` 端点。工具描述和业务消息当前使用简体中文，工具名和结构化字段名为英文。

## 写入行为

所有写入都要求稳定的 `request_id`。更新还要求详情工具返回的 `subscription_id` 和 `expected_version`。

```json
{
  "subscription_id": "42",
  "request_id": "price-update-001",
  "expected_version": "OFFSET",
  "changes": { "price": { "amount": "25.00", "currency": "CNY" } }
}
```

将 `OFFSET` 替换为返回的 64 位版本摘要。金额使用与币种代码配对的十进制字符串。对象引用支持可访问 ID、唯一精确名称，或一致的 ID/名称组合；名称有歧义时先返回候选，不执行写入。

未提供字段保持原值。`null` 清空可空的备注、网站 URL、分类、付款人或付款方式。改价格不重算周期或下一次付款日期；跟踪状态和提醒通过各自专用工具修改。提醒的 `days_before` 未提供时保留原值，`null` 使用账户默认，`0` 表示付款当天。

账户级 Durable Object 串行执行写入并保存操作账本，MCP 传输本身保持无状态。重复相同请求返回已记录结果，改变内容返回 `REQUEST_ID_CONFLICT`。超时或响应丢失可能返回 `WRITE_OUTCOME_UNKNOWN`；保留原请求 ID，重试只读取核对已知目标，不重发结果未知的新增。

版本检查是尽力冲突检测，不锁住 Wallos 网页写入，也不保证“恰好执行一次”。操作记录不自动过期。轮换 Wallos API key 会改变账本命名空间，先核对未决操作；只轮换 MCP token 则保持命名空间。重放结果描述原操作，不一定代表记录当前状态。

## 费用口径

- `monthly_equivalent`：日付按 30 天/月，周付按 30/7 周/月，月付按 1 月，年付按 1/12 年，再除以账期间隔。使用 Decimal 运算，按原币汇总后四舍五入到两位小数。
- `scheduled_payments`：复现固定版本 Wallos 的月费用日期算法，并与上游月费用接口核对可比总额。不一致时返回 `COST_CONTRACT_MISMATCH`。
- 月末和闰日沿用 PHP 日期溢出语义，不采用月底钳制；这类日期可能影响目标月时，结果附带口径说明。独立生成的 PHP 样本覆盖日历边界。
- 只计算启用记录，开始日期和手动续费处理沿用上游月费用口径；结果不是支付交易或完整预测。
- 混合币种只返回原币小计，`total: null`、`exchange_rate_date: null`，因为读取接口没有建立可验证的汇率更新时间。
- Wallos 使用浮点存储；写后核对的是实际读取到的值。

## 开发与测试

```bash
npm run check            # TypeScript 和自动测试
npm run build            # Wrangler dry-run，不部署
npm run schema:generate  # 从固定本地 OpenAPI 重新生成类型
npm run schema:refresh   # 显式下载新的上游规范快照
```

测试不需要 Cloudflare 凭据、真实 Wallos 账户或 PHP。可选的日历样本生成命令：`php scripts/calendar-fixtures.php > test/data/calendar.json`。

对明确配置的 Wallos 实例做只读契约检查：

```bash
WALLOS_BASE_URL=https://HOST/ WALLOS_API_KEY=TOKEN npm run contract
```

本地端到端测试：先运行 `npm run mock`，在 `.dev.vars` 中填写 `WALLOS_BASE_URL="http://127.0.0.1:8080/"`、`WALLOS_API_KEY="secret-upstream-key"`、`ALLOW_HTTP_UPSTREAM="true"` 和生成的 MCP token，再在另一终端运行 `npm run dev`。

```bash
MCP_AUTH_TOKEN=TOKEN npm run smoke
MCP_AUTH_TOKEN=TOKEN SMOKE_WRITES=true npm run smoke:write
```

写入测试创建一条记录，验证重放、改价、提醒和跟踪状态，最后保留停用记录。样本 API key 是测试常量，不是真实凭据。样本进程重启会重置数据，Durable Object 本地存储在 `.wrangler/` 中单独持久化。

实现和来源细节见[架构说明](docs/architecture.zh-CN.md)、[贡献指南](CONTRIBUTING.md)及[第三方说明](THIRD_PARTY_NOTICES.md)。部署使用锁定依赖，Agents 0.26.0 与其 MCP v2 peers 一起固定在兼容版本。

## 许可证

项目原创代码采用 [WTFPL 2.0](LICENSE)。第三方资料保留各自条款和来源说明，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
