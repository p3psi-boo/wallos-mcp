import { BusinessError, errorResult } from './errors.js';
import type { MutationService } from './mutations.js';
import type { ToolName } from '../tools/contracts.js';

export class WriteService {
  constructor(private mutations: MutationService) {}

  // Every call is independent: no ledger, duplicate suppression, or write queue.
  async run(tool: ToolName, input: { request_id: string } & Record<string, unknown>) {
    let dispatched = false;
    let acknowledged = false;
    let id: string | undefined;
    try {
      const prepared = await this.mutations.prepare(tool, input);
      await this.mutations.checkVersion(prepared);
      id = prepared.action === 'edit' ? prepared.form.id : undefined;
      dispatched = true;
      const reply = await this.mutations.api.write(prepared.action, prepared.form);
      acknowledged = true;
      id ??= reply.subscriptionId;
      if (id) return await this.mutations.verify(prepared, id, input.request_id);
    } catch (error) {
      const rejected = !acknowledged && error instanceof BusinessError
        && ['UPSTREAM_REJECTED', 'UPSTREAM_AUTH_ERROR', 'NOT_FOUND'].includes(error.detail.code);
      if (!dispatched || rejected) return errorResult(error);
    }
    return errorResult(new BusinessError({
      code: 'WRITE_OUTCOME_UNKNOWN', message: '写入可能已发生，结果尚待核对；本次请求未自动重试。', retryable: false,
      request_id: input.request_id, subscription_id: id,
      resolution: id ? '使用详情工具核对实际记录。服务无去重账本；重复请求会再次执行。'
        : '使用搜索工具按名称、付款人和金额核对。服务无去重账本；重复新增请求可能创建重复记录。',
    }));
  }
}
