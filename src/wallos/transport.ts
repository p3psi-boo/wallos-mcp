import type { Config } from '../config.js';
import { BusinessError, fail } from '../domain/errors.js';
import { envelopeSchema } from './schema.js';
import { z } from 'zod';

export type WireMode = 'readJson' | 'writeForm' | 'writeJson' | 'writeMultipart' | 'readCalendar';
export type Upload = { field: 'logo' | 'paymenticon'; bytes: Uint8Array; mime: string };
export class WallosTransport {
  constructor(private config: Config, private fetcher: typeof fetch) {}
  async send(path: string, mode: WireMode, form: Record<string, string>, upload?: Upload): Promise<unknown> {
    const write = mode.startsWith('write');
    const headers = new Headers({ Accept: mode === 'readCalendar' ? 'text/calendar' : 'application/json' });
    const fields = { ...form, api_key: this.config.apiKey };
    let body: string | FormData;
    if (mode === 'writeMultipart') {
      const multipart = new FormData();
      for (const [key, value] of Object.entries(fields)) multipart.set(key, value);
      if (upload) multipart.set(upload.field, new Blob([new Uint8Array(upload.bytes)], { type: upload.mime }), `image.${upload.mime === 'image/png' ? 'png' : 'jpg'}`);
      body = multipart;
    } else if (mode === 'writeJson') {
      headers.set('Content-Type', 'application/json'); body = JSON.stringify(fields);
    } else {
      headers.set('Content-Type', 'application/x-www-form-urlencoded'); body = new URLSearchParams(fields).toString();
    }
    let text: string; let contentType: string;
    try {
      const response = await this.fetcher(new URL(path, this.config.baseUrl), { method: 'POST', headers, body, redirect: 'manual', signal: AbortSignal.timeout(this.config.timeoutMs) });
      if (!response.ok) fail(write ? 'WRITE_OUTCOME_UNKNOWN' : 'UPSTREAM_HTTP_ERROR', 'Wallos HTTP 响应异常。', { retryable: !write });
      contentType = response.headers.get('Content-Type') ?? '';
      if (!response.body) throw new Error('Empty body');
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
      while (true) {
        const part = await reader.read(); if (part.done) break;
        length += part.value.length;
        if (length > 4 * 1024 * 1024) { await reader.cancel(); throw new Error('Oversized response'); }
        chunks.push(part.value);
      }
      const bytes = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (error) {
      if (error instanceof BusinessError) throw error;
      fail(write ? 'WRITE_OUTCOME_UNKNOWN' : 'UPSTREAM_UNAVAILABLE', write ? '写入结果待核对；请核对而非自动重发。' : '读取 Wallos 失败。', { retryable: !write });
    }
    if (mode === 'readCalendar' && contentType.toLowerCase().includes('text/calendar') && /^BEGIN:VCALENDAR\r?\n/.test(text) && /\r?\nEND:VCALENDAR\s*$/.test(text)) return text;
    let json: unknown;
    try { json = JSON.parse(text); } catch { fail(write ? 'WRITE_OUTCOME_UNKNOWN' : 'UPSTREAM_SCHEMA_ERROR', 'Wallos 响应格式与接口契约不符。'); }
    const envelope = envelopeSchema.safeParse(json);
    if (!envelope.success) fail(write ? 'WRITE_OUTCOME_UNKNOWN' : 'UPSTREAM_SCHEMA_ERROR', 'Wallos 响应与固定接口契约不符。');
    if (!envelope.data.success) {
      const title = envelope.data.title?.toLowerCase() ?? '';
      const code = title.includes('not found') ? 'NOT_FOUND' : title.includes('api key') || title.includes('unauthorized') ? 'UPSTREAM_AUTH_ERROR' : 'UPSTREAM_REJECTED';
      fail(code, 'Wallos 拒绝此请求；请检查字段和服务端账户配置。');
    }
    if (mode === 'readCalendar') fail('UPSTREAM_SCHEMA_ERROR', '日历响应不是有效 text/calendar。');
    return json;
  }
  async json<T extends z.ZodType>(path: string, schema: T, mode: WireMode, form: Record<string, string>, upload?: Upload): Promise<z.infer<T>> {
    const parsed = schema.safeParse(await this.send(path, mode, form, upload));
    if (!parsed.success) fail(mode.startsWith('write') ? 'WRITE_OUTCOME_UNKNOWN' : 'UPSTREAM_SCHEMA_ERROR', 'Wallos 响应字段与固定契约不符。');
    return parsed.data;
  }
}
