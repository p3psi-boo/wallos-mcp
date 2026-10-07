import { z } from 'zod';
import { resultSchema } from '../domain/errors.js';
import { amountSchema, currencyCode, dateSchema, idSchema, nameSchema } from '../domain/schema.js';
export const requestId = z.string().min(8).max(128).regex(/^[A-Za-z0-9_.:-]+$/);
export const version = z.string().regex(/^[a-f0-9]{64}$/);
export const kindSchema = z.enum(['category', 'household_member', 'payment_method', 'currency']);
export type ReferenceKind = z.infer<typeof kindSchema>;
export const scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export const stateSchema = z.record(z.string(), scalar);
export const referenceSchema = z.strictObject({ kind: kindSchema, id: idSchema, name: z.string(), version,
  in_use: z.boolean().nullable(), enabled: z.boolean().optional(), order: z.number().int().optional(),
  code: currencyCode.optional(), symbol: z.string().optional(), rate: z.string().optional(), email: z.string().nullable().optional(), icon: z.string().optional(), is_default: z.boolean().optional(),
});
const referenceFields = {
  category: z.strictObject({ name: nameSchema }),
  household_member: z.strictObject({ name: nameSchema, email: z.union([z.email().max(254), z.literal('')]).optional() }),
  payment_method: z.strictObject({ name: nameSchema, enabled: z.boolean().optional() }),
  currency: z.strictObject({ name: nameSchema, code: currencyCode, symbol: z.string().trim().min(1).max(20), rate: amountSchema.refine(v => Number(v) > 0).optional() }),
};
const createReference = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('category'), request_id: requestId, data: referenceFields.category }),
  z.strictObject({ kind: z.literal('household_member'), request_id: requestId, data: referenceFields.household_member }),
  z.strictObject({ kind: z.literal('payment_method'), request_id: requestId, data: referenceFields.payment_method }),
  z.strictObject({ kind: z.literal('currency'), request_id: requestId, data: referenceFields.currency }),
]);
const updateBase = { id: idSchema, request_id: requestId, expected_version: version };
const updateReference = z.discriminatedUnion('kind', [
  z.strictObject({ ...updateBase, kind: z.literal('category'), changes: referenceFields.category.partial().refine(v => Object.keys(v).length > 0) }),
  z.strictObject({ ...updateBase, kind: z.literal('household_member'), changes: referenceFields.household_member.partial().refine(v => Object.keys(v).length > 0) }),
  z.strictObject({ ...updateBase, kind: z.literal('payment_method'), changes: referenceFields.payment_method.partial().refine(v => Object.keys(v).length > 0) }),
  z.strictObject({ ...updateBase, kind: z.literal('currency'), changes: referenceFields.currency.partial().refine(v => Object.keys(v).length > 0) }),
]);
export const confirmedBase = { request_id: requestId, expected_version: version, dry_run: z.boolean().default(true), confirmation_token: z.string().max(4096).optional() };
export const operationSchema = z.strictObject({ request_id: requestId, operation: z.string(), target_id: z.string(), dry_run: z.boolean(),
  version: version.optional(), confirmation_token: z.string().optional(), expires_at: z.iso.datetime().optional(),
  verified: z.boolean(), verification: z.enum(['read_back', 'read_back_except_secrets', 'stored_reference_only', 'preview']),
  state: stateSchema.optional(), affected_subscription_ids: z.array(idSchema).optional(),
});
const mutationOutput = resultSchema(operationSchema);
const httpsUrl = z.url().max(2000).refine(v => { const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password && !u.hash; });
export const mediaSchema = z.discriminatedUnion('source', [
  z.strictObject({ source: z.literal('url'), url: httpsUrl }),
  z.strictObject({ source: z.literal('upload'), mime: z.enum(['image/png', 'image/jpeg']), base64: z.string().min(4).max(43692).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/) }),
]);
export type Media = z.infer<typeof mediaSchema>;
export const preferenceFields = {
  dark_theme: z.union([z.literal(0), z.literal(1), z.literal(2)]), color_theme: z.enum(['blue', 'green', 'red', 'yellow', 'purple', 'custom']),
  monthly_price: z.boolean(), convert_currency: z.boolean(), remove_background: z.boolean(), hide_disabled: z.boolean(), disabled_to_bottom: z.boolean(),
  show_original_price: z.boolean(), mobile_nav: z.boolean(), show_subscription_progress: z.boolean(), week_starts_sunday: z.boolean(),
  main_color: z.string().regex(/^#[0-9a-fA-F]{6}$/), accent_color: z.string().regex(/^#[0-9a-fA-F]{6}$/), hover_color: z.string().regex(/^#[0-9a-fA-F]{6}$/), css: z.string().max(16000),
};
export const preferencesPatch = z.strictObject(preferenceFields).partial().refine(v => Object.keys(v).length > 0);
export const configurationReadSchema = z.strictObject({ version, settings: stateSchema, managed_fields: z.array(z.string()) });
const secretAction = z.enum(['use_configured', 'clear']);
const text = z.string().max(2000);
const optionalUrl = z.union([httpsUrl, z.literal('')]);
export const adminFields = {
  registrations_open: z.boolean(), max_users: z.number().int().min(0).max(1000000), require_email_verification: z.boolean(), server_url: optionalUrl,
  smtp_address: text, smtp_port: z.number().int().min(1).max(65535), smtp_username: text, smtp_password: secretAction,
  from_email: z.union([z.email(), z.literal('')]), encryption: z.enum(['tls', 'ssl']), login_disabled: z.boolean(), update_notification: z.boolean(),
  oidc_oauth_enabled: z.boolean(), local_webhook_notifications_allowlist: text,
};
export const oidcFields = {
  oidc_enabled: z.boolean(), name: nameSchema, client_id: text, client_secret: secretAction,
  authorization_url: optionalUrl, token_url: optionalUrl, user_info_url: optionalUrl, redirect_url: optionalUrl, logout_url: optionalUrl,
  user_identifier_field: text, scopes: text, auth_style: z.enum(['auto', 'header', 'params']), auto_create_user: z.boolean(), password_login_disabled: z.boolean(), require_email_verified: z.boolean(),
};
export const adminPatch = z.strictObject(adminFields).partial().refine(v => Object.keys(v).length > 0);
export const oidcPatch = z.strictObject(oidcFields).partial().refine(v => Object.keys(v).length > 0);
export const extendedContracts = {
  wallos_get_profile: { input: z.strictObject({}), output: resultSchema(z.strictObject({ profile: stateSchema })), readOnly: true, description: '读取账户资料和预算白名单，不输出密码、API key 或头像 URL 中的凭据。预算只读。' },
  wallos_export_calendar: { input: z.strictObject({}), output: resultSchema(z.strictObject({ mime_type: z.literal('text/calendar'), content: z.string(), converted_currency: z.literal(false) })), readOnly: true, description: '通过带认证 POST 导出启用记录 ICS，保留原币；不生成含 API key 的订阅 URL。' },
  wallos_create_reference: { input: createReference, output: resultSchema(z.strictObject({ request_id: requestId, reference: referenceSchema, verified: z.literal(true) })), readOnly: false, description: '按 kind 创建分类、家庭成员、付款方式或币种；严格字段白名单。创建响应丢失时先核对，不重发。' },
  wallos_update_reference: { input: updateReference, output: resultSchema(z.strictObject({ request_id: requestId, reference: referenceSchema, verified: z.literal(true) })), readOnly: false, description: '按 kind 与 ID 局部更新参考对象；expected_version 来自 get_context；未提供字段保持原值。' },
  wallos_delete_reference: { input: z.strictObject({ ...confirmedBase, kind: kindSchema, id: idSchema }), output: mutationOutput, readOnly: false, description: '永久删除未被引用且非默认币种的参考对象。默认 dry_run 预览签名令牌；再次调用 dry_run=false 并携带令牌。' },
  wallos_delete_subscription: { input: z.strictObject({ ...confirmedBase, subscription_id: idSchema }), output: mutationOutput, readOnly: false, description: '永久删除 Wallos 记录（不是退订服务商）；预览展示将清空的替换链接，签名令牌绑定版本和影响列表。' },
  wallos_set_subscription_replacement: { input: z.strictObject({ request_id: requestId, subscription_id: idSchema, expected_version: version, replacement_subscription_id: idSchema.nullable(), replacement_expected_version: version.optional(), cancellation_date: dateSchema.nullable().optional() }).refine(v => v.replacement_subscription_id === null || v.replacement_expected_version !== undefined), output: mutationOutput, readOnly: false, description: '设置替换记录并停用旧记录，或清空替换链接。目标须属于当前账户且非自身；两个版本均需校验。仅一次上游编辑，不实际退订。' },
  wallos_set_subscription_logo: { input: z.strictObject({ request_id: requestId, subscription_id: idSchema, expected_version: version, media: mediaSchema }), output: mutationOutput, readOnly: false, description: '设置订阅 logo：公网 HTTPS URL 或最大 32 KiB PNG/JPEG base64；由 Wallos 抓取或处理图片，不读取本地路径。' },
  wallos_set_payment_method_icon: { input: z.strictObject({ request_id: requestId, id: idSchema, expected_version: version, media: mediaSchema }), output: mutationOutput, readOnly: false, description: '设置已有付款方式图标，支持公网 HTTPS URL 或最大 32 KiB PNG/JPEG 上传，要求参考对象版本。' },
  wallos_get_preferences: { input: z.strictObject({}), output: resultSchema(configurationReadSchema), readOnly: true, description: '读取当前账户 UI 偏好、主题、颜色和 CSS 的白名单及版本；不是预算或通知通道配置。' },
  wallos_update_preferences: { input: z.strictObject({ request_id: requestId, expected_version: version, changes: preferencesPatch }), output: mutationOutput, readOnly: false, description: '局部更新账户偏好，校验版本；未提供保持原值，css 空串清空。发送前验证合并颜色，避免上游部分写入。' },
  wallos_get_fixer_settings: { input: z.strictObject({}), output: resultSchema(configurationReadSchema), readOnly: true, description: '可选配置工具：读取汇率提供商配置，仅输出密钥是否配置。' },
  wallos_update_fixer_settings: { input: z.strictObject({ ...confirmedBase, provider: z.union([z.literal(0), z.literal(1)]), api_key_action: secretAction }), output: mutationOutput, readOnly: false, description: '可选配置工具：预览后修改 Fixer/APILayer 配置；密钥只能来自服务端 WALLOS_FIXER_API_KEY 或显式 clear，避免省略导致清空。不是刷新汇率。' },
  wallos_get_admin_settings: { input: z.strictObject({}), output: resultSchema(configurationReadSchema), readOnly: true, description: '可选管理员配置工具：读取全局设置白名单，不返回 SMTP 密码。Wallos 仍校验管理员。' },
  wallos_update_admin_settings: { input: z.strictObject({ ...confirmedBase, changes: adminPatch }), output: mutationOutput, readOnly: false, description: '可选管理员配置工具：默认预览，确认后局部更新。SMTP 密码仅配置引用或 clear；环境托管字段提前拒绝。' },
  wallos_get_oidc_settings: { input: z.strictObject({}), output: resultSchema(configurationReadSchema), readOnly: true, description: '可选管理员配置工具：读取 OIDC 设置与环境托管字段；不返回 client_secret。' },
  wallos_update_oidc_settings: { input: z.strictObject({ ...confirmedBase, changes: oidcPatch }), output: mutationOutput, readOnly: false, description: '可选管理员配置工具：预览并确认 OIDC 修改；客户端密钥来自服务端配置或 clear；环境托管字段提前拒绝。' },
  wallos_set_password_login: { input: z.strictObject({ ...confirmedBase, disabled: z.boolean() }), output: mutationOutput, readOnly: false, description: '可选管理员配置工具：独立设置 OIDC 的密码登录开关，默认预览；不与 admin.login_disabled 混为一谈。' },
} as const;
export const configurationToolNames = new Set<string>(['wallos_get_fixer_settings', 'wallos_update_fixer_settings', 'wallos_get_admin_settings', 'wallos_update_admin_settings', 'wallos_get_oidc_settings', 'wallos_update_oidc_settings', 'wallos_set_password_login']);
