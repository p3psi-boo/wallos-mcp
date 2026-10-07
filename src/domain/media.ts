import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import type { Media } from '../tools/extended-contracts.js';
import type { Upload } from '../wallos/transport.js';
import { fail } from './errors.js';
const blocked = new BlockList();
for (const [base, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) blocked.addSubnet(base, prefix, 'ipv4');
const globalV6 = new BlockList(); globalV6.addSubnet('2000::', 3, 'ipv6');
const deniedV6 = new BlockList(); deniedV6.addSubnet('2001::', 23, 'ipv6'); deniedV6.addSubnet('2002::', 16, 'ipv6'); deniedV6.addSubnet('2001:db8::', 32, 'ipv6'); deniedV6.addSubnet('3fff::', 20, 'ipv6');
export function isPublicAddress(address: string) {
  return isIP(address) === 4 ? !blocked.check(address, 'ipv4') : isIP(address) === 6 && globalV6.check(address, 'ipv6') && !deniedV6.check(address, 'ipv6');
}
export async function prepareMedia(media: Media, field: Upload['field'], timeoutMs: number) {
  if (media.source === 'upload') {
    const bytes = Buffer.from(media.base64, 'base64');
    if (!bytes.length || bytes.length > 32768 || bytes.toString('base64') !== media.base64) fail('INVALID_IMAGE', '图片必须为规范 base64 且最多 32 KiB。');
    const valid = media.mime === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    if (!valid) fail('INVALID_IMAGE', '图片签名与 MIME 不匹配。');
    return { form: {}, upload: { field, bytes, mime: media.mime } satisfies Upload };
  }
  const url = new URL(media.url);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) fail('INVALID_IMAGE_URL', '图片地址需为公网 HTTPS 默认端口。');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const addresses = isIP(hostname) ? [{ address: hostname }] : await Promise.race([
      lookup(hostname, { all: true }), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('DNS timeout')), timeoutMs); }),
    ]);
    if (!addresses.length || addresses.some(a => !isPublicAddress(a.address))) fail('INVALID_IMAGE_URL', '图片域名需全部解析到公网地址。');
  } catch { fail('INVALID_IMAGE_URL', '图片地址校验失败。'); } finally { if (timer) clearTimeout(timer); }
  // Actual download is done by Wallos; its SSRF/redirect protections must remain enabled.
  return { form: { [field === 'logo' ? 'logo_url' : 'icon_url']: url.href }, upload: undefined };
}
