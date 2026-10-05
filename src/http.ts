import { createMcpHandler } from 'agents/mcp/server';
import { readConfig, type Env } from './config';
import { createServer } from './tools/server';
import { digest } from './domain/identity';

async function validToken(header: string | null, expected: string) {
  if (!header?.startsWith('Bearer ')) return false;
  const [a, b] = await Promise.all([digest(header.slice(7)), digest(expected)]);
  let different = 0;
  for (let i = 0; i < a.length; i++) different |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return different === 0;
}
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') return Response.json({ status: 'ok', service: 'wallos-mcp', phase: 2 });
    if (url.pathname !== '/mcp') return new Response('Not found', { status: 404 });
    const origins = (env.ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean);
    const origin = request.headers.get('Origin');
    if (origin && !origins.includes(origin)) return new Response('Origin not allowed', { status: 403 });
    const headers = new Headers({ 'Cache-Control': 'no-store' });
    if (origin) {
      headers.set('Access-Control-Allow-Origin', origin); headers.set('Vary', 'Origin');
      headers.set('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
      headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept, MCP-Protocol-Version, MCP-Session-Id, Last-Event-ID');
      headers.set('Access-Control-Expose-Headers', 'MCP-Session-Id, MCP-Protocol-Version');
    }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (!env.MCP_AUTH_TOKEN || env.MCP_AUTH_TOKEN.length < 32) return Response.json({ error: 'MCP_AUTH_TOKEN must contain at least 32 characters' }, { status: 503, headers });
    if (!await validToken(request.headers.get('Authorization'), env.MCP_AUTH_TOKEN)) {
      headers.set('WWW-Authenticate', 'Bearer realm="wallos-mcp"');
      return Response.json({ error: 'Invalid bearer token' }, { status: 401, headers });
    }
    if (!['POST', 'GET', 'DELETE'].includes(request.method)) return new Response('Method not allowed', { status: 405, headers });
    if (Number(request.headers.get('Content-Length') ?? 0) > 65536) return new Response('Request too large', { status: 413, headers });
    try {
      if (request.method === 'POST' && request.body) {
        const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
        while (true) {
          const { value, done } = await reader.read(); if (done) break;
          length += value.length;
          if (length > 65536) { await reader.cancel(); return new Response('Request too large', { status: 413, headers }); }
          chunks.push(value);
        }
        const bytes = new Uint8Array(length); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        request = new Request(request, { body: bytes });
      }
      const config = readConfig(env);
      // A deployment represents a single Wallos account. Credential changes isolate the ledger.
      const id = env.WALLOS_ACCOUNT.idFromName(await digest({ url: config.baseUrl, key: config.apiKey }));
      const stub = env.WALLOS_ACCOUNT.get(id);
      const handler = createMcpHandler(() => createServer((name, input) => stub.invoke(name, input)), { corsOptions: false, allowedOriginHostnames: "*" });
      const response = await handler(request, env, ctx);
      const merged = new Headers(response.headers);
      headers.forEach((value, key) => merged.set(key, value));
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers: merged });
    } catch { return Response.json({ error: 'Server configuration or transport error' }, { status: 503, headers }); }
  },
} satisfies ExportedHandler<Env>;
