import { createMcpHandler } from '@modelcontextprotocol/server';
import type { Env } from './config.js';
import type { Invoke } from './tools/server.js';
import { createServer } from './tools/server.js';

export const REQUEST_BODY_LIMIT = 65536;

export function createHttpHandler(env: Env, openAccount: (apiKey: string) => Invoke) {
  const mcp = createMcpHandler(ctx => {
    const apiKey = ctx.authInfo?.token;
    if (!apiKey) throw new Error('Missing request account');
    return createServer(openAccount(apiKey), env.ENABLE_CONFIGURATION_TOOLS === 'true');
  });
  return {
    close: () => mcp.close(),
    async fetch(request: Request): Promise<Response> {
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
      const apiKey = url.searchParams.get('key');
      if (!apiKey) return Response.json({ error: 'Missing key' }, { status: 401, headers });
      url.searchParams.delete('key');
      request = new Request(url, request);
      if (!['POST', 'GET', 'DELETE'].includes(request.method)) return new Response('Method not allowed', { status: 405, headers });
      if (Number(request.headers.get('Content-Length') ?? 0) > REQUEST_BODY_LIMIT) return new Response('Request too large', { status: 413, headers });
      try {
        if (request.method === 'POST' && request.body) {
          const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
          while (true) {
            const { value, done } = await reader.read(); if (done) break;
            length += value.length;
            if (length > REQUEST_BODY_LIMIT) { await reader.cancel(); return new Response('Request too large', { status: 413, headers }); }
            chunks.push(value);
          }
          const bytes = new Uint8Array(length); let offset = 0;
          for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
          request = new Request(request, { body: bytes });
        }
        const response = await mcp.fetch(request, { authInfo: { token: apiKey, clientId: 'query-key', scopes: [] } });
        const merged = new Headers(response.headers);
        headers.forEach((value, key) => merged.set(key, value));
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers: merged });
      } catch { return Response.json({ error: 'Server configuration or transport error' }, { status: 503, headers }); }
    },
  };
}
