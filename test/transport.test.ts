import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { WallosTransport } from '../src/wallos/transport';
import { paths } from '../src/wallos/client';
import { config } from './fixture';
describe('wire contracts', () => {
  it('covers every pinned OpenAPI path through fixed adapter endpoints', () => {
    const spec = parse(readFileSync('vendor/wallos/openapi.yaml','utf8'));
    expect(Object.keys(spec.paths)).toHaveLength(24);
    expect(Object.values(paths).map(p => `/${p}`).sort()).toEqual(Object.keys(spec.paths).sort());
  });
  it.each(['readJson','writeForm','writeJson','writeMultipart'] as const)('implements %s without credentials in URL or leaked response fields', async mode => {
    let called = false;
    const transport = new WallosTransport(config, async (input,init) => {
      called = true; const url = new URL(String(input)); expect(url.search).toBe(''); expect(init?.method).toBe('POST'); expect(init?.redirect).toBe('manual');
      const headers = new Headers(init?.headers);
      if (mode === 'writeMultipart') { expect(headers.has('Content-Type')).toBe(false); expect(init?.body).toBeInstanceOf(FormData); expect((init?.body as FormData).get('api_key')).toBe(config.apiKey); }
      else if (mode === 'writeJson') { expect(headers.get('Content-Type')).toBe('application/json'); expect(JSON.parse(String(init?.body)).api_key).toBe(config.apiKey); }
      else expect(new URLSearchParams(String(init?.body)).get('api_key')).toBe(config.apiKey);
      return Response.json({ success: true, id: '1', secret: 'SECRET' });
    });
    expect(await transport.json(paths.setCategories,z.object({ id: z.string() }),mode,{ action: 'add' })).toEqual({ id: '1' }); expect(called).toBe(true);
  });
  it('rejects oversized read and write responses with appropriate retryability', async () => {
    const transport = new WallosTransport(config, async () => new Response('x'.repeat(4*1024*1024+1)));
    await expect(transport.send(paths.profile,'readJson',{})).rejects.toMatchObject({ detail: { code: 'UPSTREAM_UNAVAILABLE', retryable: true } });
    await expect(transport.send(paths.setPreferences,'writeForm',{})).rejects.toMatchObject({ detail: { code: 'WRITE_OUTCOME_UNKNOWN', retryable: false } });
  });
  it('checks calendar MIME and handles JSON authentication errors without exposing messages', async () => {
    const transport = new WallosTransport(config, async () => Response.json({ success: false, title: 'Invalid API key', message: config.apiKey }));
    await expect(transport.send(paths.calendar,'readCalendar',{})).rejects.toMatchObject({ detail: { code: 'UPSTREAM_AUTH_ERROR' } });
    const wrongMime = new WallosTransport(config, async () => new Response('BEGIN:VCALENDAR\nEND:VCALENDAR\n', { headers: { 'Content-Type': 'text/html' } }));
    await expect(wrongMime.send(paths.calendar,'readCalendar',{})).rejects.toMatchObject({ detail: { code: 'UPSTREAM_SCHEMA_ERROR' } });
  });
});
