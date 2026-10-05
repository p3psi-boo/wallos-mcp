import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { parse, stringify } from 'yaml';
const entry = resolve('vendor/wallos/openapi.yaml');
const root = parse(await readFile(entry, 'utf8'));
async function expand(value: unknown, base: string): Promise<unknown> {
  if (Array.isArray(value)) return Promise.all(value.map(v => expand(v, base)));
  if (!value || typeof value !== 'object') return value;
  const obj = value as Record<string, unknown>;
  if (typeof obj.$ref === 'string' && !obj.$ref.startsWith('#')) {
    if (!obj.$ref.startsWith('./') || obj.$ref.includes('..') || obj.$ref.includes('#')) throw new Error(`Unsupported external ref ${obj.$ref}`);
    const filename = resolve(dirname(base), obj.$ref);
    return expand(parse(await readFile(filename, 'utf8')), filename);
  }
  return Object.fromEntries(await Promise.all(Object.entries(obj).map(async ([k, v]) => [k, await expand(v, base)])));
}
const bundled = await expand(root, entry) as Record<string, unknown>;
// Demo server is source documentation only, never a deployment default.
bundled.servers = [];
await writeFile('vendor/wallos/bundled.yaml', stringify(bundled));
console.log('Bundled pinned schemas locally.');
