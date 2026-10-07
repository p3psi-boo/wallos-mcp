import { McpServer, type StandardSchemaWithJSON } from '@modelcontextprotocol/server';
import { configurationToolNames } from './extended-contracts.js';
import { contracts, type ToolName } from './contracts.js';
import { costPolicy } from '../domain/costs.js';
import { errorResult } from '../domain/errors.js';
export type Invoke = (name: ToolName, input: unknown) => Promise<unknown>;
export function createServer(invoke: Invoke, configurationTools = false) {
  const server = new McpServer({ name: 'wallos-mcp', version: '0.1.0' });
  for (const [name, contract] of Object.entries(contracts)) {
    if (!configurationTools && configurationToolNames.has(name)) continue;
    server.registerTool(name, {
      description: contract.description, inputSchema: contract.input as StandardSchemaWithJSON, outputSchema: contract.output as StandardSchemaWithJSON,
      annotations: { readOnlyHint: contract.readOnly, destructiveHint: !contract.readOnly, idempotentHint: contract.readOnly, openWorldHint: false },
    }, async (input: unknown) => {
      let result: unknown;
      try { result = await invoke(name as ToolName, input); } catch (error) { result = errorResult(error); }
      const parsed = contract.output.safeParse(result);
      const structured = parsed.success ? parsed.data : errorResult(new Error('Output schema mismatch'));
      return { content: [{ type: 'text', text: JSON.stringify(structured) }], structuredContent: structured, isError: !structured.ok };
    });
  }
  server.registerResource('cost-policy', 'wallos://cost-policy', { description: '费用口径与阶段边界', mimeType: 'application/json' }, async uri => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(costPolicy) }] }));
  server.registerResource('reference-data', 'wallos://reference-data', { description: '当前账户参考数据（字段白名单）', mimeType: 'application/json' }, async uri => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await invoke('wallos_get_context', {})) }] }));
  server.registerResource('calendar', 'wallos://calendar', { description: '当前账户的认证日历导出（原币）', mimeType: 'text/calendar' }, async uri => {
    const result = await invoke('wallos_export_calendar', {}) as { ok: boolean; data?: { content: string } };
    if (!result.ok || !result.data) throw new Error('Calendar export failed');
    return { contents: [{ uri: uri.href, mimeType: 'text/calendar', text: result.data.content }] };
  });
  return server;
}
