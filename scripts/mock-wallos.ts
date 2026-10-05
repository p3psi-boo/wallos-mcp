// Local contract fixture only; does not contact a real Wallos instance.
import { createServer } from 'node:http';
import { Fixture, config } from '../test/fixture';
const fixture = new Fixture();
const server = createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const response = await fixture.fetch(`${config.baseUrl}${req.url?.replace(/^\//, '')}`, { method: req.method, body: Buffer.concat(chunks).toString() });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(await response.text());
  } catch { res.writeHead(500); res.end('{"success":false}'); }
});
server.listen(8080, '127.0.0.1', () => console.log('Wallos fixture: http://127.0.0.1:8080/ (API key: secret-upstream-key)'));
