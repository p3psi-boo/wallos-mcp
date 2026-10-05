import { BusinessError, errorResult, fail } from '../domain/errors';
import { digest } from '../domain/identity';
import type { MutationService, PreparedMutation } from '../domain/mutations';
import type { ToolName } from '../tools/contracts';
export interface OperationRecord {
  fingerprint: string; state: 'preparing' | 'dispatching' | 'unknown' | 'done';
  tool: ToolName; started_at: string; completed_at?: string;
  prepared?: PreparedMutation; subscription_id?: string; result?: unknown;
}
export interface OperationStore {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<unknown>;
}
export class OperationRunner {
  // Serializes writes across awaits within an instance. Durable records survive eviction.
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private store: OperationStore, private mutations: MutationService) {}
  run(tool: ToolName, input: { request_id: string } & Record<string, unknown>): Promise<unknown> {
    const task = this.tail.then(() => this.execute(tool, input));
    this.tail = task.catch(() => {});
    return task;
  }
  private async execute(tool: ToolName, input: { request_id: string } & Record<string, unknown>) {
    const key = `operation:${input.request_id}`;
    const fingerprint = await digest({ tool, input });
    let record = await this.store.get<OperationRecord>(key);
    if (record) {
      if (record.fingerprint !== fingerprint) return errorResult(new BusinessError({ code: 'REQUEST_ID_CONFLICT', message: '同一 request_id 对应不同工具或内容；尚未再次写入。', retryable: false }));
      if (record.state === 'done') return record.result;
      // A known target can be reconciled read-only, even after a crash between write and verification.
      if (record.subscription_id && record.prepared) {
        try {
          const result = await this.mutations.verify(record.prepared, record.subscription_id, input.request_id);
          await this.store.put(key, { ...record, state: 'done', result, completed_at: new Date().toISOString() });
          return result;
        } catch { /* Preserve the uncertainty, never redispatch. */ }
      }
      return errorResult(new BusinessError({ code: 'WRITE_OUTCOME_UNKNOWN', message: '已有请求尚未确认结果；没有重复提交写入。', retryable: false, request_id: input.request_id,
        subscription_id: record.subscription_id, resolution: '通过详情或搜索核对 Wallos；创建响应丢失时按名称、付款人和金额核对。不要换 request_id 自动重发。' }));
    }
    record = { fingerprint, state: 'preparing', tool, started_at: new Date().toISOString() };
    await this.store.put(key, record);
    try {
      const prepared = await this.mutations.prepare(tool, input);
      await this.mutations.checkVersion(prepared);
      record = { ...record, prepared, subscription_id: prepared.action === 'edit' ? prepared.form.id : undefined, state: 'dispatching' };
      // Persist before the first outbound write. A restart in this window results in uncertainty, not replay.
      await this.store.put(key, record);
      const reply = await this.mutations.api.write(prepared.action, prepared.form);
      const id = prepared.action === 'edit' ? prepared.form.id : reply.subscriptionId;
      if (!id) fail('WRITE_OUTCOME_UNKNOWN', '新增响应没有记录 ID；请搜索核对，保持 request_id。');
      record = { ...record, subscription_id: id };
      await this.store.put(key, record);
      const result = await this.mutations.verify(prepared, id, input.request_id);
      await this.store.put(key, { ...record, state: 'done', result, completed_at: new Date().toISOString() });
      return result;
    } catch (error) {
      // Once dispatch began, only explicit upstream rejection proves no successful write.
      const definite = record.state === 'preparing' || (error instanceof BusinessError && ['UPSTREAM_REJECTED', 'UPSTREAM_AUTH_ERROR', 'NOT_FOUND'].includes(error.detail.code));
      const result = definite ? errorResult(error) : errorResult(new BusinessError({ code: 'WRITE_OUTCOME_UNKNOWN', message: '写入结果尚待核对；没有自动重试。', retryable: false,
        request_id: input.request_id, subscription_id: record.subscription_id, resolution: '保持 request_id 重试可尝试只读核对；也可调用搜索/详情核对记录。' }));
      await this.store.put(key, { ...record, state: definite ? 'done' : 'unknown', result, completed_at: definite ? new Date().toISOString() : undefined });
      return result;
    }
  }
}
