# 阶段二架构与操作协议

[English](architecture.md) | [简体中文](architecture.zh-CN.md)

## 关键选择

1. **不是 OpenAPI → Tools 通用代理。** 固定路径 API adapter 是内部实现；工具只描述订阅任务。生成的 OpenAPI 包含管理接口，不代表这些接口在运行时开放。
2. **业务状态与传输状态分离。** `createMcpHandler` 提供无会话 HTTP 协议；账户 DO 只提供内部 RPC 和持久化业务去重。部署不使用 `McpAgent`。
3. **一个部署代表一个账户。** 身份来自服务端绑定的 Wallos key，客户端只提交独立 Bearer token；DO 名称为根地址及 Wallos key 的 SHA-256。引用和记录归属由当前账户的读取结果及上游查询条件验证。
4. **写入不盲目重试。** 稳定 request ID 绑定规范化工具输入的 SHA-256，未知结果只走核对路径。
5. **不隐藏费用模型。** 总费用按全部记录计算；下一次付款列表明确覆盖边界；混合币种不返回猜测总额。

## 操作状态机

```text
不存在
  ↓ 持久化 fingerprint / tool / started_at
preparing
  ↓ 字段、引用、版本校验；保存 prepared（不含 API key）
dispatching
  ↓ 一次上游 add/edit；保存返回 ID；读取验证
  ├─ 核对成功 → done + result + completed_at
  ├─ 明确上游拒绝 → done + error
  └─ 超时/坏响应/读取失败/写后不符 → unknown

恢复/重试：
  done → 返回原结果
  内容改变 → REQUEST_ID_CONFLICT
  unknown/dispatching/preparing：
    已知 ID + prepared → 只读核对 → 成功可 done
    未知 ID/核对不符 → WRITE_OUTCOME_UNKNOWN，不重新发送
```

实例内 Promise 队列串行所有写入，读取不排队；持久化操作状态在发送上游写请求前完成。DO 被回收后，旧队列不再存在，但操作记录阻止同一请求重新派发。旧实例中未决请求与上游完成之间仍可能出现不确定窗口，因此不声称“恰好执行一次”。

写后验证逐个比较实际请求字段，价格按 Decimal 比较；输出实际前后差异，包含上游伴随变化。网页在最终版本检查之后仍可能修改记录，此窗口由上游缺少条件更新能力决定。

操作记录包含业务请求及前后结果，属于账户私有数据。密钥不写入操作记录；不打印上游错误正文。当前不自动清理历史记录，保留跨重试去重语义。

## 输入与输出

- 对象引用：可访问 ID / 唯一精确名称；同名候选返回 `AMBIGUOUS_REFERENCE`，ID 名称矛盾返回 `REFERENCE_MISMATCH`。
- 订阅更新只接受已解析 ID；普通字段、状态、提醒三类工具互不重叠。
- 原生金额与币种成对读取，`convert_currency=false`；不会把上游换算后的金额配回原币代码。
- 输入 strict object，陌生字段在协议或 DO 校验层被拦截。
- 每工具有具体输出 Schema，`structuredContent` 与 JSON 文本内容相同；业务失败 `isError=true`。
- 成功包含 `meta.retrieved_at`、`meta.coverage` 和 `warnings`；错误包含 code、retryable、resolution，以及必要候选/请求/记录 ID。
- HTTP 限制实际请求体 64 KiB；API 响应上限 4 MiB；超限不返回伪完整结果。

## OpenAPI 与 PHP 契约

来源快照保存 25 个文档的原始下载 SHA-256；本地 YAML 经规范化且 `$ref` 改为本地相对路径，故本地文件字节校验值与下载值不同。bundle 清除 Demo Server 地址，以免它成为运行时目标。

`generated.d.ts` 由完整本地 bundle 生成，API 路径通过 TypeScript 约束；响应 Zod 单独定义以处理 PHP 将数值编码为字符串、空通知设置返回数组、空字段清理等差异。订阅写入虽然 OpenAPI 描述 multipart，当前参数无文件且 PHP 从 `$_POST` 读取，所以适配器发送 `application/x-www-form-urlencoded`。

生产版本变化时先运行只读 `npm run contract`，再审阅规范/PHP 差异；日历黄金样本可由 `php scripts/calendar-fixtures.php > test/data/calendar.json` 重新生成。默认测试读取已固定样本，不依赖 PHP、网络或真实账户。

## 第三阶段边界

永久删除及其预览/确认计划、完整未来账期展开、辅助对象管理和批量操作尚未注册。提醒只保存配置，记录停用不等于服务商退订。扩展时应增加独立业务契约和测试，而不是开放任意 HTTP 请求工具。
