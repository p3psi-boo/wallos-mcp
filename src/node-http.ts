import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { REQUEST_BODY_LIMIT, type createHttpHandler } from './http.js';

type HttpHandler = ReturnType<typeof createHttpHandler>;

function tooLarge(res: ServerResponse) {
  res.writeHead(413, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store', Connection: 'close' });
  res.end('Request too large');
}

async function readBody(req: IncomingMessage, res: ServerResponse) {
  if (Number(req.headers['content-length'] ?? 0) > REQUEST_BODY_LIMIT) {
    tooLarge(res);
    req.resume();
    return;
  }
  const chunks: Buffer[] = [];
  let length = 0;
  // Bound the stream before the SDK's Node adapter buffers it. Preserve the
  // connection on early return long enough to send the 413 response.
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length > REQUEST_BODY_LIMIT) {
      tooLarge(res);
      req.resume();
      return;
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, length);
}

export function createNodeServer(handler: HttpHandler) {
  const node = toNodeHandler(handler);
  return createServer({ requestTimeout: 15000, headersTimeout: 10000 }, (req, res) => {
    void (async () => {
      const body = await readBody(req, res);
      if (body === undefined) return;
      await node({
        headers: req.headers, method: req.method, url: req.url,
        async *[Symbol.asyncIterator]() { if (body.length) yield body; },
      }, res);
    })().catch(() => {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: 'HTTP transport error' }));
      } else res.destroy();
    });
  });
}
