import type { Config } from '../config.js';
import { WallosClient, paths } from '../wallos/client.js';
import { z } from 'zod';
import { numericId } from '../wallos/schema.js';
import { type ReferenceKind, referenceSchema } from '../tools/extended-contracts.js';
import { digest } from './identity.js';
import { fail, success } from './errors.js';
import { formFields, verifiedWrite } from './verified-write.js';
import { Confirmation } from './confirmation.js';
import { Decimal } from 'decimal.js';

const endpoints = { category: paths.setCategories, currency: paths.setCurrencies, household_member: paths.setHousehold, payment_method: paths.setPaymentMethods } as const;
const responseIds = { category: 'categoryId', currency: 'currencyId', household_member: 'memberId', payment_method: 'paymentId' } as const;
export type Reference = z.infer<typeof referenceSchema>;
export class ReferenceService {
  constructor(private api: WallosClient, private config: Config) {}
  async list(kind: ReferenceKind): Promise<Reference[]> {
    const currency = kind === 'currency' ? await this.api.currencies() : undefined;
    const rows = currency?.currencies ?? (kind === 'category' ? await this.api.categories() : kind === 'household_member' ? await this.api.members() : await this.api.paymentMethods());
    return Promise.all(rows.map(async row => {
      const value = { kind, ...row, in_use: row.in_use ?? null, ...(currency ? { is_default: row.id === currency.main_currency } : {}) };
      return referenceSchema.parse({ ...value, version: await digest(value) });
    }));
  }
  async get(kind: ReferenceKind, id: string) {
    const ref = (await this.list(kind)).find(r => r.id === id);
    if (!ref) fail('REFERENCE_NOT_FOUND', '对象不属于当前账户或已被删除。');
    return ref;
  }
  async current(kind: ReferenceKind, id: string, expected: string) {
    const row = await this.get(kind, id);
    if (row.version !== expected) fail('VERSION_CONFLICT', '参考对象版本已变化，请重新读取 get_context。');
    return row;
  }
  async write(kind: ReferenceKind, action: string, form: Record<string, string>) {
    const idField = responseIds[kind];
    return this.api.wire(endpoints[kind], z.object({ [idField]: numericId.optional() }), kind === 'payment_method' ? 'writeMultipart' : 'writeForm', { ...form, action });
  }
  private verifyFields(row: Reference, changes: Record<string, unknown>) {
    const state = row as unknown as Record<string, unknown>;
    for (const [key, expected] of Object.entries(changes)) {
      const actual = state[key];
      if (key === 'rate' && actual !== undefined && new Decimal(String(actual)).equals(String(expected))) continue;
      if (actual !== expected) fail('VERIFICATION_FAILED', '参考对象读回值不匹配。');
    }
  }
  async create(kind: ReferenceKind, requestId: string, data: Record<string, unknown>) {
    let id: string | undefined;
    return verifiedWrite(requestId, async () => { id = (await this.write(kind, 'add', formFields(data)))[responseIds[kind]]; }, async () => {
      if (!id) fail('VERIFICATION_FAILED', '新增响应缺少 ID。');
      const reference = await this.get(kind, id); this.verifyFields(reference, data);
      return success({ request_id: requestId, reference, verified: true });
    });
  }
  async update(kind: ReferenceKind, id: string, requestId: string, expected: string, changes: Record<string, unknown>) {
    const before = await this.current(kind, id, expected);
    const required = kind === 'currency' ? { name: before.name, symbol: before.symbol, code: before.code }
      : kind === 'household_member' ? { name: before.name, email: before.email ?? '' } : { name: before.name };
    // PHP household edits default an omitted email to empty: explicitly preserve it.
    if (kind === 'household_member' && before.email === undefined && changes.email === undefined) fail('UPSTREAM_SCHEMA_ERROR', '家庭成员缺少保留既有邮箱所需字段。');
    if (kind === 'payment_method' && changes.enabled === false && before.enabled !== false) {
      if (before.in_use || (await this.api.subscriptions()).some(r => r.payment_method_id === id)) fail('REFERENCE_IN_USE', '付款方式仍被订阅引用，尚未停用。');
    }
    if (kind === 'currency' && (!before.symbol || !before.code)) fail('UPSTREAM_SCHEMA_ERROR', '币种缺少编辑所需名称、符号或代码。');
    await this.current(kind, id, expected);
    return verifiedWrite(requestId, () => this.write(kind, 'edit', { ...formFields({ ...required, ...changes }), id }), async () => {
      const reference = await this.get(kind, id); this.verifyFields(reference, { ...required, ...changes });
      return success({ request_id: requestId, reference, verified: true });
    });
  }
  async delete(input: { kind: ReferenceKind; id: string; request_id: string; expected_version: string; dry_run: boolean; confirmation_token?: string }) {
    const before = await this.current(input.kind, input.id, input.expected_version);
    const field = { category: 'category_id', currency: 'currency_id', household_member: 'payer_user_id', payment_method: 'payment_method_id' } as const;
    const used = (await this.api.subscriptions()).filter(r => r[field[input.kind]] === input.id);
    if (before.in_use || used.length || before.is_default) fail('REFERENCE_IN_USE', '对象仍被订阅引用或为默认币种。');
    const intent = { kind: input.kind, id: input.id, version: before.version };
    const confirmation = new Confirmation(this.config); const operation = 'wallos_delete_reference';
    if (input.dry_run) return success({ request_id: input.request_id, operation, target_id: input.id, dry_run: true, verified: false, verification: 'preview', state: { kind: input.kind, name: before.name }, ...await confirmation.issue(operation, intent) });
    await confirmation.verify(input.confirmation_token, operation, intent);
    await this.current(input.kind, input.id, input.expected_version);
    if ((await this.api.subscriptions()).some(r => r[field[input.kind]] === input.id)) fail('REFERENCE_IN_USE', '对象已被订阅引用，请重新预览。');
    return verifiedWrite(input.request_id, () => this.write(input.kind, 'delete', { id: input.id }), async () => {
      if ((await this.list(input.kind)).some(r => r.id === input.id)) fail('VERIFICATION_FAILED', '删除后对象仍然存在。');
      return success({ request_id: input.request_id, operation, target_id: input.id, dry_run: false, verified: true, verification: 'read_back' });
    });
  }
}
