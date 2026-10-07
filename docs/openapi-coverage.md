# OpenAPI coverage / OpenAPI 覆盖与编排

The pinned spec contains **24 paths / 27 method-path operations**. All 24 paths now have fixed runtime adapters; tools use authenticated **POST** bodies instead of exposing duplicate GET/POST tools. Path coverage does not mean every response field or future upstream feature is exposed.

固定规范包含 **24 条路径 / 27 个方法与路径组合**。24 条路径均已接入固定适配器，通过带凭据的 **POST 请求体**调用，不为 GET/POST 重复注册工具。路径覆盖不代表暴露全部响应字段或后续上游功能。

All endpoint paths below start with `/api/`. Configuration rows are disabled unless `ENABLE_CONFIGURATION_TOOLS=true`.

下列端点均以 `/api/` 开头；配置分组默认关闭。

| Endpoint | Tools / 用途 | Group / 分组 |
| --- | --- | --- |
| `currencies/get_currencies.php` | `wallos_get_context`; reference validation | Default |
| `currencies/set_currencies.php` | `wallos_create_reference`, `wallos_update_reference`, `wallos_delete_reference` (`currency`) | Default |
| `categories/get_categories.php` | `wallos_get_context`; reference validation | Default |
| `categories/set_categories.php` | Reference CRUD (`category`) | Default |
| `household/get_household.php` | `wallos_get_context`; reference validation | Default |
| `household/set_household.php` | Reference CRUD (`household_member`) | Default |
| `payment_methods/get_payment_methods.php` | `wallos_get_context`; reference validation | Default |
| `payment_methods/set_payment_methods.php` | Reference CRUD (`payment_method`), `wallos_set_payment_method_icon` | Default |
| `notifications/get_notification_settings.php` | Reminder status in `wallos_get_context` | Default |
| `users/get_user.php` | `wallos_get_profile` | Default |
| `subscriptions/get_subscriptions.php` | Search, upcoming payments, costs; delete/link checks | Default |
| `subscriptions/get_subscription.php` | Details, version checks, read-back | Default |
| `subscriptions/get_monthly_cost.php` | Comparable scheduled-month cost verification | Default |
| `subscriptions/get_ical_feed.php` | `wallos_export_calendar`, `wallos://calendar` | Default |
| `subscriptions/set_subscriptions.php` | Create, update, state, reminder, delete, replacement, logo | Default |
| `settings/get_settings.php` | `wallos_get_preferences` | Default |
| `settings/set_settings.php` | `wallos_update_preferences` | Default |
| `fixer/get_fixer.php` | `wallos_get_fixer_settings` | Configuration |
| `fixer/set_fixer.php` | `wallos_update_fixer_settings` | Configuration |
| `admin/get_admin_settings.php` | `wallos_get_admin_settings` | Configuration |
| `admin/set_admin_settings.php` | `wallos_update_admin_settings` | Configuration |
| `admin/get_oidc_settings.php` | `wallos_get_oidc_settings`; managed-field checks | Configuration |
| `admin/set_oidc_settings.php` | `wallos_update_oidc_settings` | Configuration |
| `admin/set_disable_password_login.php` | `wallos_set_password_login` | Configuration |

## Wire differences / 线上契约差异

- `categories/set_categories.php` is documented as JSON, but the pinned PHP reads only `$_POST`: the adapter uses form encoding. The transport also supports JSON writes for future verified contracts; no current endpoint is switched to JSON speculatively.
- File writes use multipart with `logo` or `paymenticon`. Reference/payment-method writes also use multipart as documented. Other writes use forms. Every read sends the account key in a POST body; no API-key calendar URLs are produced.
- Calendar success is bounded `text/calendar`, not JSON; JSON errors are still interpreted and sanitized.
- Preferences flatten `custom_css.css` and the three `custom_colors` values; omission preserves other fields.
- Currency edits merge required existing `name/symbol/code` before dispatch; household edits retain both name and email because PHP clears an omitted email. Reference schemas strip private fields.
- OIDC `managed_fields` can be a map or a list; `enabled` maps to `oidc_enabled`. Managed OIDC fields are blocked before dispatch, including mixed enablement/secret requests. The admin getter does not consistently expose an effective webhook allowlist/environment override: unseen overrides may cause a read-back mismatch and `WRITE_OUTCOME_UNKNOWN`, not verified success.
- The current PHP supports features beyond this pinned spec (for example a third rate provider). They are not silently enabled through these contracts.

分类写入规范标注 JSON，固定 PHP 却只读 `$_POST`，因此实际使用表单；没有推测性地切换到 JSON。文件使用 multipart，其余写入使用表单；日历解析独立于 JSON。偏好字段在适配层展开；币种、家庭成员编辑合并上游要求的既有字段（尤其邮箱：省略会被 PHP 清空）。环境托管 OIDC 字段在发送前检查；管理员读接口未完整暴露 webhook 白名单的环境覆盖时，读回不符按结果未知处理，不宣称验证成功。

## Orchestration / 编排

```text
context → reference CRUD → create/edit subscription
create new → read old + both versions → link/deactivate old
read target → preview impact + signed token → caller confirms → execute → read-back
read preferences → validate merged patch → one write → read-back
opt in → read configuration → secret reference + preview → confirm → write → scoped verification
```

The client owns multi-step orchestration. The server executes one mutation per execute call, keeps no transaction/operation history, and does not compensate automatically. A partial or unknown outcome is reconciled through reads. Tokens bind intent and expire; they are not consumption records.

客户端负责编排多步操作；服务端每次执行最多一次修改，不保存事务/操作历史，不自动补偿。部分生效或结果未知时通过读取核对。确认令牌绑定意图与有效期，不记录是否已消费。

No profile/budget write, notification-channel write, or explicit exchange-rate-refresh endpoint exists in the pinned spec. Full future-payment expansion would be a separately specified derived capability, not an invented upstream endpoint. Bulk transactions remain outside scope.

固定规范没有资料/预算写入、通知通道写入或显式汇率刷新端点。完整未来账期展开应单独定义为派生能力，不伪造上游接口；批量事务仍不在当前范围内。
