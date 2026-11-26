# Agent 操作指南（`wallos-mcp`）

## 1. 服务定位与 `eql12` 部署拓扑

- **服务职责**：面向 Wallos 订阅管理的无状态 Streamable HTTP MCP 服务（Node.js 24+ ESM + TypeScript + `@modelcontextprotocol/server` v2，仓库 `https://github.com/p3psi-boo/wallos-mcp.git`）。
- **生产共置与网络边界**：线上共置于 `eql12` k3s `wallos` Pod 的 `mcp` 容器内（编排：`~/nixcfg/hosts/eql12/services/wallos.nix`，镜像锁：`~/nixcfg/gitops/releases/wallos-mcp.nix`），监听 `127.0.0.1:18084` 并访问同 Pod `http://127.0.0.1:80/`，经前置 Nginx `location = /mcp`（内网 `http://wallos.internal/mcp`）暴露；独立部署时须支持双栈 `HOST=::`。

## 2. 无状态鉴权、命名空间隔离与写保护红线

- **调用方密钥透传与剥离**：HTTP 运行时**严禁在服务端读取或共用固定 `WALLOS_API_KEY`**（`WALLOS_API_KEY` 仅限本地 `smoke`/`contract` 脚本使用）。每次请求从 URL `?key=` 提取调用方专属 Wallos API Key（对接 `small-executor` 按命名空间如 `default`/`ss` 隔离密钥池），提取后立即从转发 URL 剥离，缺失直接返回 `401`。
- **写操作两阶段确认与表单语义对齐**：破坏性写操作与配置类工具（`ENABLE_CONFIGURATION_TOOLS=true`）受 `MCP_CONFIRMATION_KEY`（`>= 32` 字符）确认令牌保护；订阅查询、查重与变更参数必须对齐 Wallos Web 页面表单兼容引用规则。

## 3. MCP 错误可观测与脱敏顺序红线

- **应用层结构化错误日志（弥补前置 Nginx 关闭访问日志）**：生产前置 Nginx 为防 `?key=` 落盘对 `/mcp` 设了 `access_log off;`。修改 `src/http.ts`、`src/node-http.ts` 或 `src/tools/server.ts` 时，必须确保 MCP 工具异常、JSON-RPC `-32603` 与上游 Wallos 非 2xx 响应向 `stderr` 输出脱敏的结构化错误摘要（工具名、错误码/根因类、上游状态码、耗时），**严禁静默 `catch` 吞掉异常仅回空泛 `503` 或 `Internal error`**。
- **先脱敏后序列化与截断**：任何日志或错误响应在 `JSON.stringify` 和长度截断前，必须先抹除 URL `?key=`、`api_key`、`Authorization`、`Cookie`、`MCP_CONFIRMATION_KEY` 以及 `WALLOS_FIXER_API_KEY` / `WALLOS_SMTP_PASSWORD` / `WALLOS_OIDC_CLIENT_SECRET`。

## 4. 本地开发与校验门禁

- **测试与注释边界**：仓库保留存量 `vitest` 套件；遵循全局红线不擅自新增测试文件，存量断言因需求合法变更失效时当轮同步更新。
- **每次改动必跑门禁**：
  ```bash
  npm run check && npm run build
  ```
  涉及协议或工具 schema 变更时，配合本地 Mock（`npm run mock`）执行 `npm run smoke` 并核验 `GET /health` 返回 `{"status":"ok","service":"wallos-mcp"}`。
