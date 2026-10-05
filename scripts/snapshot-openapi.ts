// Build-time-only source retrieval. Runtime tools never fetch schemas.
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { parse, stringify } from 'yaml';
const rootUrl = 'https://api.wallosapp.com/openapi.yaml';
const target = 'vendor/wallos';
const sources: { url: string; sha256: string }[] = [];
async function download(url: URL) {
  if (url.origin !== 'https://api.wallosapp.com') throw new Error('Unexpected schema source');
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Source returned ${response.status}: ${url}`);
  const text = await response.text();
  if (text.includes('<html')) throw new Error(`HTML source: ${url}`);
  sources.push({ url: url.href, sha256: createHash('sha256').update(text).digest('hex') });
  return parse(text);
}
const root = await download(new URL(rootUrl));
for (const [path, item] of Object.entries(root.paths as Record<string, { $ref: string }>)) {
  const url = new URL(item.$ref, rootUrl); // $ref is relative to the document, NOT servers.url.
  const schema = await download(url);
  const dest = join(target, url.pathname);
  await mkdir(dirname(dest), { recursive: true }); await writeFile(dest, stringify(schema));
  root.paths[path] = { $ref: `.${url.pathname}` };
}
await writeFile(join(target, 'openapi.yaml'), stringify(root));
await writeFile(join(target, 'sources.json'), JSON.stringify({ retrieved_at: new Date().toISOString(), root_url: rootUrl,
  php_contract_commit: 'cc9677a67e76ac55c13f373d4c7cc5ca9007079e', sources }, null, 2) + '\n');
console.log(`Saved ${sources.length} pinned OpenAPI sources.`);
