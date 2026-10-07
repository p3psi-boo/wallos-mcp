import type { Config } from './config.js';
import { errorResult, fail } from './domain/errors.js';
import { ReadService } from './domain/reads.js';
import { MutationService } from './domain/mutations.js';
import { WriteService } from './domain/writes.js';
import { ExtensionService } from './domain/extensions.js';
import { configurationToolNames } from './tools/extended-contracts.js';
import { contracts, coreContracts, isToolName } from './tools/contracts.js';
import { WallosClient } from './wallos/client.js';

export class WallosAccount {
  private extensions: ExtensionService;
  private configurationTools: boolean;
  private reads: ReadService;
  private writes: WriteService;
  constructor(config: Config, api = new WallosClient(config)) {
    this.configurationTools = config.configurationTools ?? false;
    this.extensions = new ExtensionService(api, config);
    this.reads = new ReadService(api, config);
    this.writes = new WriteService(new MutationService(api, config));
  }
  async invoke(name: string, input: unknown): Promise<unknown> {
    try {
      if (!isToolName(name) || (!this.configurationTools && configurationToolNames.has(name))) fail('INVALID_TOOL', '工具不存在或所属配置分组未启用。');
      const parsed = contracts[name].input.safeParse(input);
      if (!parsed.success) fail('INVALID_INPUT', '输入字段与工具契约不符。', { resolution: '按工具 inputSchema 提交；写入需 request_id（仅关联标识），更新需 expected_version。' });
      const result = !Object.hasOwn(coreContracts, name) ? await this.extensions.invoke(name, parsed.data) : contracts[name].readOnly ? await this.reads.invoke(name, parsed.data)
        : await this.writes.run(name, parsed.data as { request_id: string } & Record<string, unknown>);
      const checked = contracts[name].output.safeParse(result);
      if (!checked.success) fail('OUTPUT_SCHEMA_ERROR', '工具结果未通过输出契约校验。');
      return checked.data;
    } catch (error) { return errorResult(error); }
  }
}
