// Local contract fixture only; does not contact a real Wallos instance.
import { createServer } from 'node:http';
import { config } from '../test/fixture';
import { ExtendedFixture } from '../test/extended-fixture';
const fixture = new ExtendedFixture();
const server = createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const headers = new Headers();
    if (req.headers['content-type']) headers.set('Content-Type', req.headers['content-type']);
    const url = `${config.baseUrl}${req.url?.replace(/^\//, '')}`;
    const bytes = Buffer.concat(chunks);
    const body = headers.get('Content-Type')?.includes('multipart/form-data')
      ? await new Request(url, { method: 'POST', headers, body: bytes }).formData() : bytes.toString();
    const response = await fixture.fetch(url, { method: req.method, headers, body });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(await response.text());
  } catch { res.writeHead(500); res.end('{"success":false}'); }
});
server.listen(8080, '127.0.0.1', () => console.log('Wallos fixture: http://127.0.0.1:8080/ (API key: secret-upstream-key)'));
