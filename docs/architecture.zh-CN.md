# 无状态架构与写入协议

[English](architecture.md) | [简体中文](architecture.zh-CN.md)

## 组件

```text
MCP 客户端
    │ Streamable HTTP + Bearer token
    ▼
Node.js HTTP 服务 /mcp
    │ 独立处理每个请求
    ▼
账户范围的读取及写入服务
    │ 固定路径、表单编码的 API 请求
    ▼
Wallos 账户（持久化业务数据）
```

官方 SDK 的 `createMcpHandler` 为每个请求创建新的 MCP server，由 Node 传输适配器返回 HTTP 响应。服务没有会话、数据库、操作账本、结果缓存或写入队列。配置和可复用服务对象保留在进程内，但不保存跨请求的业务历史。

工具不是 OpenAPI → Tools 通用代理。固定路径 API adapter 是内部实现，工具只描述订阅任务；完整规范快照中的管理接口不代表运行时开放这些接口。

一个部署连接配置的 Wallos key 对应账户。`request_id` 只在结果中作为调用方关联标识，不生成存储键或请求指纹。等价副本无需会话粘滞即可独立处理后续请求。

## 独立写入流程

```text
校验输入及账户范围引用
    ↓
读取记录并检查 expected_version（仅更新）
    ↓
提交前再次检查版本
    ↓
发送一次上游 add/edit
    ├─ 明确上游拒绝 → 业务错误
    ├─ 响应丢失、坏响应或新增缺少 ID → WRITE_OUTCOME_UNKNOWN
    └─ 已收到成功响应及已知 ID
            ↓
        读取并比较提交字段
            ├─ 核对成功 → 返回已验证结果
            └─ 读取失败或字段不符 → WRITE_OUTCOME_UNKNOWN
```

每次调用只持有当前请求所需的临时值。响应后没有可以重放或恢复的操作记录。相同 ID 的重复新增也是独立写入；同一 ID 改内容不返回请求 ID 冲突。服务不在单次请求内自动重试修改。

未知结果标记为不可自动重试。已知目标使用详情工具核对，未知目标使用搜索核对；再次调用写入工具是重新执行，不是只读恢复路径。上游已经接受修改之后，即使核对返回 `NOT_FOUND`，也属于结果未知，不代表修改被拒绝。

版本检查不锁住并发请求、其他副本、Wallos 网页或其他写入方。两个请求可能在任一修改发生前都通过检查；没有上游原子比较更新，也没有“恰好执行一次”保证。旧版本更新会重新校验，不重放历史成功结果。

写后验证逐项比较提交字段，价格使用 Decimal 比较。输出实际前后差异，包含上游伴随变化；不打印或返回上游原始错误正文。

## 运行与部署

`src/index.ts` 读取环境变量、校验启动配置并启动 Node.js HTTP 服务。`src/node-http.ts` 在传输适配前限制原始请求体；`src/http.ts` 处理路由、Bearer 认证、浏览器 Origin 精确校验及 SDK handler。关闭时停止接收新请求并关闭 MCP 流，最长等待 30 秒。

编译后通过 `npm start` 运行。Docker Compose 使用同一份代码，以非 root 用户运行，不需要数据卷。HTTPS 由前置反向代理处理；多副本只共享配置的 Wallos 账户，不共享应用数据库或操作历史。

## 输入与输出

- 对象引用支持可访问 ID 或唯一精确名称；同名返回 `AMBIGUOUS_REFERENCE`，ID 与名称矛盾返回 `REFERENCE_MISMATCH`。
- 订阅更新只接受明确的 ID；普通字段、跟踪状态和提醒通过专用工具修改。
- 原生金额与币种成对读取，使用 `convert_currency=false`，不混配上游换算金额和原币代码。
- 输入使用 strict object，陌生字段在协议或账户服务校验层被拦截。
- 每个工具都有具体输出 Schema，`structuredContent` 与 JSON 文本一致，业务失败设置 `isError=true`。
- 成功包含 `meta.retrieved_at`、`meta.coverage` 和业务说明；错误包含 code、retryable、resolution 及必要的候选、请求或记录 ID。
- 实际 HTTP 请求体上限 64 KiB，上游响应上限 4 MiB，超限不返回伪完整结果。

## 费用和日期口径

付款列表只返回记录的下一次付款；费用汇总读取全部启用订阅，不只计算搜索页。月均折算和指定月预计费用使用不同口径。

指定月费用复现固定 PHP 版本的日期语义，包括月末和闰日溢出；可比的单币种总额与上游核对。混合币种保持独立，因为读取契约没有可验证的汇率更新时间。完整口径通过 `wallos://cost-policy` 提供。

PHP 样本生成器仅用于离线测试，服务和默认测试均不依赖 PHP。

## OpenAPI 来源与契约

`vendor/wallos/sources.json` 记录 25 个原始文档的下载 SHA-256 和 PHP 参考提交。检入 YAML 已规范化且外部 `$ref` 改为本地路径，字节哈希与原始下载不同；bundle 清除 Demo Server 地址。

`src/wallos/generated.d.ts` 从本地 bundle 生成并约束 API 路径。运行时 Zod 独立处理 PHP 数字字符串、空通知数组和可空字段。当前写入没有文件参数，PHP 从 `$_POST` 读取，因此使用 `application/x-www-form-urlencoded`。

更新上游契约时先运行只读 `npm run contract`，再审阅规范、生成类型及 PHP 假设；日期行为改变时重新生成 PHP 样本，最后运行 `npm run check`、`npm run build`。

## 后续阶段

永久删除及确认计划、完整未来付款展开、辅助数据管理和批量修改尚未注册。新增能力使用独立契约和测试，不开放任意 HTTP 代理。
