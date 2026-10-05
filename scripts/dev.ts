import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const env = { ...process.env };
// NixOS does not normally provide the ELF loader path embedded in npm's workerd binary.
// Select an existing compatible loader locally; do not alter system files or downloaded binaries.
if (!env.MINIFLARE_WORKERD_PATH && process.platform === 'linux' && existsSync('/nix/store')) {
  const binary: string = require('workerd').default;
  const probe = spawnSync(binary, ['--version'], { stdio: 'ignore' });
  if (probe.error && 'code' in probe.error && probe.error.code === 'ENOENT' && existsSync(binary)) {
    const loader = readdirSync('/nix/store').filter(name => name.includes('-glibc-'))
      .map(name => join('/nix/store', name, 'lib/ld-linux-x86-64.so.2'))
      .find(path => existsSync(path) && spawnSync(path, [binary, '--version'], { stdio: 'ignore' }).status === 0);
    if (!loader) throw new Error('No compatible local glibc loader for workerd. Set MINIFLARE_WORKERD_PATH to a runnable workerd launcher.');
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
    mkdirSync('.wrangler', { recursive: true });
    const wrapper = resolve('.wrangler/workerd-launcher.sh');
    writeFileSync(wrapper, `#!/bin/sh\nexec ${quote(loader)} ${quote(binary)} "$@"\n`, { mode: 0o700 });
    env.MINIFLARE_WORKERD_PATH = wrapper;
  }
}
const wranglerCli = resolve(dirname(require.resolve('wrangler/package.json')), require('wrangler/package.json').bin.wrangler);
const child = spawn(process.execPath, [wranglerCli, 'dev', ...process.argv.slice(2)], { env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => child.kill(signal));
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 130 : 1); });
