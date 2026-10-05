import { DurableObject } from 'cloudflare:workers';
import { readConfig, type Env } from './config';
import { errorResult, fail } from './domain/errors';
import { ReadService } from './domain/reads';
import { MutationService } from './domain/mutations';
import { OperationRunner } from './operations/runner';
import { contracts, isToolName } from './tools/contracts';
import { WallosClient } from './wallos/client';

export class WallosAccount extends DurableObject<Env> {
  private reads?: ReadService;
  private writes?: OperationRunner;
  async invoke(name: string, input: unknown): Promise<unknown> {
    try {
      if (!isToolName(name)) fail('INVALID_TOOL', '工具不在第二阶段白名单中。');
      const parsed = contracts[name].input.safeParse(input);
      if (!parsed.success) fail('INVALID_INPUT', '输入字段与工具契约不符。', { resolution: '按工具 inputSchema 提交；写入需稳定 request_id，更新需 expected_version。' });
      if (!this.reads || !this.writes) {
        const config = readConfig(this.env);
        const api = new WallosClient(config);
        this.reads = new ReadService(api, config);
        this.writes = new OperationRunner(this.ctx.storage, new MutationService(api, config));
      }
      const result = contracts[name].readOnly ? await this.reads.invoke(name, parsed.data)
        : await this.writes.run(name, parsed.data as { request_id: string } & Record<string, unknown>);
      const checked = contracts[name].output.safeParse(result);
      if (!checked.success) fail('OUTPUT_SCHEMA_ERROR', '工具结果未通过输出契约校验。');
      return checked.data;
    } catch (error) { return errorResult(error); }
  }
}
