import { z } from 'zod';
import type { Config } from '../config.js';
import { WallosClient, paths } from '../wallos/client.js';
import type { ToolInput } from '../tools/contracts.js';
import { digest } from './identity.js';
import { fail, success } from './errors.js';
import { checkVersion, formFields, verifiedWrite } from './verified-write.js';
import { Confirmation } from './confirmation.js';
import { ReferenceService } from './references.js';
import { prepareMedia } from './media.js';

export class SubscriptionExtras {
  constructor(private api: WallosClient, private config: Config) {}
  async delete(input: ToolInput<'wallos_delete_subscription'>) {
    const read = async () => {
      const row = await this.api.subscription(input.subscription_id); await checkVersion(row, input.expected_version);
      const affected = (await this.api.subscriptions()).filter(r => r.replacement_subscription_id === row.id).sort((a,b) => Number(a.id)-Number(b.id));
      return { row, affected, intent: { id: row.id, version: input.expected_version, affected: await Promise.all(affected.map(async r => ({ id: r.id, version: await digest(r) }))) } };
    };
    const { row, affected, intent } = await read();
    const confirmation = new Confirmation(this.config); const operation = 'wallos_delete_subscription';
    const base = { request_id: input.request_id, operation, target_id: row.id, affected_subscription_ids: affected.map(r => r.id) };
    if (input.dry_run) return success({ ...base, dry_run: true, verified: false, verification: 'preview', state: { name: row.name }, ...await confirmation.issue(operation, intent) });
    await confirmation.verify(input.confirmation_token, operation, intent);
    await confirmation.verify(input.confirmation_token, operation, (await read()).intent);
    return verifiedWrite(input.request_id, () => this.api.write('delete', { id: row.id }), async () => {
      const rows = await this.api.subscriptions();
      if (rows.some(r => r.id === row.id || r.replacement_subscription_id === row.id)) fail('VERIFICATION_FAILED', '删除或替换关系清理尚未确认。');
      return success({ ...base, dry_run: false, verified: true, verification: 'read_back' }, ['仅删除 Wallos 记录，未联系服务商。']);
    });
  }
  async replacement(input: ToolInput<'wallos_set_subscription_replacement'>) {
    const read = async () => {
      const row = await this.api.subscription(input.subscription_id); await checkVersion(row, input.expected_version);
      if (input.replacement_subscription_id) {
        if (input.replacement_subscription_id === row.id) fail('INVALID_REPLACEMENT', '替换目标应为另一个记录。');
        const replacement = await this.api.subscription(input.replacement_subscription_id); await checkVersion(replacement, input.replacement_expected_version!);
        if (replacement.inactive) fail('INVALID_REPLACEMENT', '替换目标须为启用记录。');
        // Reject cycles, including older chains already present upstream.
        const rows = await this.api.subscriptions(); let cursor: string | null | undefined = replacement.id; const visited = new Set([row.id]);
        while (cursor) { if (visited.has(cursor)) fail('INVALID_REPLACEMENT', '替换关系形成循环。'); visited.add(cursor); cursor = rows.find(r => r.id === cursor)?.replacement_subscription_id; }
      }
      return row;
    };
    const row = await read();
    const form = formFields({ id: row.id, replacement_subscription_id: input.replacement_subscription_id, ...(input.replacement_subscription_id ? { inactive: true } : {}), cancellation_date: input.cancellation_date });
    await read();
    return verifiedWrite(input.request_id, () => this.api.write('edit', form), async () => {
      const after = await this.api.subscription(row.id);
      if ((after.replacement_subscription_id ?? null) !== input.replacement_subscription_id || (input.replacement_subscription_id && !after.inactive) || (input.cancellation_date !== undefined && after.cancellation_date !== input.cancellation_date)) fail('VERIFICATION_FAILED', '替换关系读回值不匹配。');
      return success({ request_id: input.request_id, operation: 'wallos_set_subscription_replacement', target_id: row.id, dry_run: false, verified: true, verification: 'read_back', version: await digest(after), state: { replacement_subscription_id: after.replacement_subscription_id ?? null, tracking_state: after.inactive ? 'inactive' : 'active', cancellation_date: after.cancellation_date } }, ['仅更新 Wallos 跟踪关系；创建新记录与本次编辑是独立操作。']);
    });
  }
  async logo(input: ToolInput<'wallos_set_subscription_logo'>) {
    const row = await this.api.subscription(input.subscription_id); await checkVersion(row, input.expected_version);
    const media = await prepareMedia(input.media, 'logo', this.config.timeoutMs);
    await checkVersion(await this.api.subscription(row.id), input.expected_version);
    return verifiedWrite(input.request_id, () => this.api.wire(paths.write, z.object({}), 'writeMultipart', { id: row.id, action: 'edit', ...media.form }, media.upload), async () => {
      const after = await this.api.subscription(row.id);
      if (!after.logo) fail('VERIFICATION_FAILED', '上游未返回已保存的 logo 引用。');
      return success({ request_id: input.request_id, operation: 'wallos_set_subscription_logo', target_id: row.id, dry_run: false, verified: false, verification: 'stored_reference_only', version: await digest(after), state: { logo: after.logo } }, ['已确认存储引用；Wallos 会重编码图片，未校验图片字节或视觉内容。'], 'partial');
    });
  }
  async icon(input: ToolInput<'wallos_set_payment_method_icon'>) {
    const refs = new ReferenceService(this.api, this.config);
    const row = await refs.current('payment_method', input.id, input.expected_version);
    const media = await prepareMedia(input.media, 'paymenticon', this.config.timeoutMs);
    await refs.current('payment_method', row.id, input.expected_version);
    return verifiedWrite(input.request_id, () => this.api.wire(paths.setPaymentMethods, z.object({}), 'writeMultipart', { id: row.id, action: 'edit', ...media.form }, media.upload), async () => {
      const after = await refs.get('payment_method', row.id);
      if (!after.icon) fail('VERIFICATION_FAILED', '上游未返回图标引用。');
      return success({ request_id: input.request_id, operation: 'wallos_set_payment_method_icon', target_id: row.id, dry_run: false, verified: false, verification: 'stored_reference_only', version: after.version, state: { icon: after.icon } }, ['已确认存储引用，未校验图片内容。'], 'partial');
    });
  }
}
