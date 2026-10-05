# Wallos MCP

[English](README.md) | [简体中文](README.zh-CN.md)

基于 TypeScript 和 Node.js 的无状态、自托管 [Model Context Protocol](https://modelcontextprotocol.io/) HTTP 服务器，通过 `/mcp` 的 Streamable HTTP 接口提供 9 个 [Wallos](https://github.com/ellite/Wallos) 订阅管理工具，支持 Node.js 进程和 Docker 容器部署。

每次部署连接一个 Wallos 账户。MCP 服务没有会话、数据库、操作账本、请求去重或写入队列，Wallos 是唯一的持久化业务数据源。

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

资源：`wallos://reference-data`、`wallos://cost-policy`。

操作修改的是 Wallos 记录，不是服务商账户或实际扣款。保存提醒配置不代表通知已经送达。付款列表的覆盖范围为 `next_payment_only`。当前工具集不含完整账期展开、永久删除、辅助数据管理、批量写入、管理员设置或自动 Logo 下载。

## 快速开始

使用 Node.js 24；支持的 Node.js 版本见 [`package.json`](package.json)。准备一个已运行的 Wallos 实例和账户 API key。

```bash
git clone https://github.com/p3psi-boo/wallos-mcp.git
cd wallos-mcp
npm ci
cp .env.example .env
```

编辑 `.env`，填写 Wallos 安装根地址、Wallos API key 和独立的 MCP Bearer token。生成 MCP token：

```bash
openssl rand -hex 32
```

编译并启动服务：

```bash
npm run build
npm start
```

默认端点：`http://127.0.0.1:8787/mcp`。`npm start` 和 `npm run dev` 都会加载可选的 `.env` 文件，进程中已有的环境变量优先。本地开发时可用 `npm run dev` 直接运行源码并自动重启，无需先编译。

## 配置

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `WALLOS_BASE_URL` | Wallos 安装根地址，包含安装子目录 | 必填 |
| `WALLOS_API_KEY` | 当前 Wallos 账户的 API key | 必填 |
| `MCP_AUTH_TOKEN` | 独立的客户端 Bearer token，至少 32 字符 | 必填 |
| `HOST` | HTTP 监听地址 | `127.0.0.1` |
| `PORT` | HTTP 监听端口，1–65535 | `8787` |
| `TIMEZONE` | 业务日期使用的 IANA 时区 | `UTC` |
| `UPSTREAM_TIMEOUT_MS` | 上游超时，100–60000 毫秒 | `10000` |
| `ALLOW_HTTP_UPSTREAM` | 显式允许通过 HTTP 连接 Wallos | `false` |
| `ALLOWED_ORIGINS` | 逗号分隔的浏览器 Origin 精确白名单 | 空 |

如果 Wallos 安装在 `https://HOST/wallos/`，填写此根地址，而不是 `/api` 下的某个接口。HTTP 上游需要设置 `ALLOW_HTTP_UPSTREAM=true`。

配置的 MCP token 允许调用当前账户的全部 9 个工具。多个账户使用独立部署和 token。账户身份、上游凭据和上游根地址属于服务端配置，不属于工具参数。`payer_member` 指家庭成员，不是 Wallos 登录账户；订阅的网站 URL 则是普通记录字段。

没有 Origin 请求头的桌面和命令行客户端正常连接。浏览器请求的 Origin 必须精确匹配 `ALLOWED_ORIGINS`。`GET /health` 只检查服务存活，不探测 Wallos 连通性。

## 自托管部署

### Node.js

复制 `.env.example` 为 `.env`，填写 Wallos 根地址和凭据，然后运行：

```bash
npm ci
npm run check
npm run build
npm start
```

用进程管理器保持服务运行。默认只监听回环地址；容器内或需要其他机器访问时设置 `HOST=0.0.0.0`。公开的 HTTPS 端点由前置 HTTPS 反向代理提供，保留 Authorization 请求头和流式响应。

### Docker Compose

Docker 部署需要 Docker Engine 和 Compose，宿主机无需安装 Node.js。复制 `.env.example` 为 `.env`，填写 Wallos 根地址和凭据，然后运行：

```bash
docker compose up -d --build
docker compose logs -f wallos-mcp
```

Compose 默认发布 `http://127.0.0.1:8787/mcp`，将容器内的 `HOST`、`PORT` 覆盖为 `0.0.0.0:8787`。可选的 `MCP_BIND_ADDRESS`、`MCP_PORT` 控制宿主机端口绑定。镜像以非 root 用户运行，不需要数据库或数据卷。

配置的 Wallos 根地址必须能从服务进程或容器访问。Docker 内的 `127.0.0.1` 指 MCP 容器自身；使用可访问的主机名，或同一 Docker 网络内的 Wallos 服务名。HTTP 根地址需要设置 `ALLOW_HTTP_UPSTREAM=true`。

验证服务：

```bash
curl http://127.0.0.1:8787/health
MCP_URL=http://127.0.0.1:8787/mcp MCP_AUTH_TOKEN=TOKEN npm run smoke
```

服务不需要独立数据库或持久化存储。`.env` 已被 Git 忽略，也不进入 Docker 构建上下文。

## 连接 MCP 客户端

选择 **Streamable HTTP**，使用对应部署的端点：

| 部署方式 | 端点 |
| --- | --- |
| 默认本地 Node.js 或 Compose | `http://127.0.0.1:8787/mcp` |
| HTTPS 反向代理 | `https://HOST/mcp` |

将服务端配置的 MCP token 放入请求头：

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

所有写入都要求 `request_id`，但它**仅用于关联请求，不是幂等键**。

更新前先调用 `wallos_get_subscription`，将返回的 `data.subscription_id` 填入 `subscription_id`，将 `data.version` 填入 `expected_version`：

```json
{
  "subscription_id": "42",
  "request_id": "price-update-001",
  "expected_version": "OFFSET",
  "changes": { "price": { "amount": "25.00", "currency": "CNY" } }
}
```

将 `OFFSET` 替换为返回的 SHA-256 版本摘要，即 64 个十六进制字符。金额使用与币种代码配对的十进制字符串。对象引用支持可访问 ID、唯一精确名称，或一致的 ID/名称组合；名称有歧义时先返回候选，不执行写入。

未提供字段保持原值。`null` 清空可空的备注、网站 URL、分类、付款人或付款方式。改价格不重算周期或下一次付款日期；跟踪状态和提醒通过各自专用工具修改。提醒的 `days_before` 未提供时保留原值，`null` 使用账户默认，`0` 表示付款当天。

每个写入请求独立校验字段和引用，更新时检查版本，最多发送一次上游修改，再读取核对结果。服务不保存请求历史，也不串行执行写入。重复发送新增请求，即使 ID 和内容相同，也可能新增另一条记录；同一 ID 换内容不会被拒绝。

超时、响应丢失、新增缺少 ID 或写后核对失败，可能返回 `WRITE_OUTCOME_UNKNOWN`，并标记 `retryable: false`。服务不自动重发，也不在后续写入请求中恢复原操作。已知 ID 时调用详情核对，未知 ID 时按名称、付款人和金额搜索后再决定下一步。重复使用旧版本更新，可能返回 `VERSION_CONFLICT`，而不是重放原来的成功结果。

版本检查是尽力冲突检测，不提供上游原子比较更新，也不锁住并发请求、其他副本或 Wallos 网页写入，没有“恰好执行一次”保证。多副本无需共享数据库或会话粘滞，但并发修改仍可能竞争。重启服务没有操作历史；轮换 API key 后直接使用新 key 对应的账户。

## 费用口径

- `monthly_equivalent`：日付按 30 天/月，周付按 30/7 周/月，月付按 1 月，年付按 1/12 年，再除以账期间隔。使用 Decimal 运算，按原币汇总后四舍五入到两位小数。
- `scheduled_payments`：复现固定版本 Wallos 的月费用日期算法，并与上游月费用接口核对可比总额。不一致时返回 `COST_CONTRACT_MISMATCH`。
- 月末和闰日沿用 PHP 日期溢出语义，不采用月底钳制；这类日期可能影响目标月时，结果附带口径说明。独立生成的 PHP 样本覆盖日历边界。
- 只计算启用记录，开始日期和手动续费处理沿用上游月费用口径；结果不是支付交易或完整预测。
- 混合币种只返回原币小计，`total: null`、`exchange_rate_date: null`，因为读取接口没有建立可验证的汇率更新时间。
- Wallos 使用浮点存储；写后核对的是实际读取到的值。

## 开发与测试

```bash
npm run dev              # 直接运行源码，改动后自动重启
npm run check            # TypeScript 和自动测试
npm run build            # 编译 Node.js 服务到 dist/
npm run schema:generate  # 从固定本地 OpenAPI 重新生成类型
npm run schema:refresh   # 显式下载新的上游规范快照
```

测试不需要真实 Wallos 账户或 PHP，包含真实 Node.js HTTP 传输测试。可选的日历样本生成命令：`php scripts/calendar-fixtures.php > test/data/calendar.json`。

对明确配置的 Wallos 实例做只读契约检查：

```bash
WALLOS_BASE_URL=https://HOST/ WALLOS_API_KEY=TOKEN npm run contract
```

本地端到端测试：先运行 `npm run mock`，在 `.env` 中填写 `WALLOS_BASE_URL="http://127.0.0.1:8080/"`、`WALLOS_API_KEY="secret-upstream-key"`、`ALLOW_HTTP_UPSTREAM="true"` 和生成的 MCP token，再在另一终端运行 `npm run dev`。

```bash
MCP_AUTH_TOKEN=TOKEN npm run smoke
MCP_AUTH_TOKEN=TOKEN SMOKE_WRITES=true npm run smoke:write
```

写入测试创建一条记录，验证改价、提醒和跟踪状态，最后保留停用记录。样本 API key 是测试常量，不是真实凭据。样本进程重启会重置数据，MCP 服务没有独立的持久化状态。

实现和来源细节见[架构说明](docs/architecture.zh-CN.md)、[贡献指南](CONTRIBUTING.md)及[第三方说明](THIRD_PARTY_NOTICES.md)。部署使用锁定依赖，MCP server/client/Node 传输包固定在兼容版本。

## 许可证

项目原创代码采用 [WTFPL 2.0](LICENSE)。第三方资料保留各自条款和来源说明，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
