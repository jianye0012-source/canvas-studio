import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import spawn from 'cross-spawn';
import crypto from 'node:crypto';

export const sourceRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const appVersion = JSON.parse(await fs.readFile(path.join(sourceRoot, 'launcher/package.json'), 'utf8')).version;
export async function run(command, args, options = {}) {
  await new Promise((resolve, reject) => { const child = spawn(command, args, { cwd: sourceRoot, stdio: 'inherit', env: { ...process.env, TMPDIR: path.join(sourceRoot, 'work/tmp'), npm_config_cache: path.join(sourceRoot, 'work/cache/npm'), GOPATH: path.join(sourceRoot, 'work/cache/go'), GOCACHE: path.join(sourceRoot, 'work/cache/go-build'), GOTOOLCHAIN: 'local', NEXT_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1', ...options.env }, ...options }); child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))); });
}
const omit = new Set(['.git', 'node_modules', '.next', '.cache', 'test', '.github', '.agents']);
export async function copy(source, target, extraOmit = []) { await fs.cp(source, target, { recursive: true, dereference: true, filter: name => !omit.has(path.basename(name)) && !extraOmit.includes(path.basename(name)) }); }
export async function fileManifest(root, excluded = []) {
  const files = [];
  async function visit(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (excluded.includes(entry.name)) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile()) { const hash = crypto.createHash('sha256'); for await (const chunk of (await import('node:fs')).createReadStream(file)) hash.update(chunk); files.push({ path: path.relative(root, file).split(path.sep).join('/'), size: (await fs.stat(file)).size, sha256: hash.digest('hex') }); }
    }
  }
  await visit(root); return files.sort((a,b) => a.path.localeCompare(b.path));
}

export async function prepareBundle(platform) {
  const bundle = path.join(sourceRoot, 'work', `bundle-${platform === 'win32' ? 'windows' : 'linux'}`);
  await fs.mkdir(path.join(bundle, 'runtime'), { recursive: true });
  if (platform !== 'win32') await fs.copyFile(process.execPath, path.join(bundle, 'runtime/node'));
  let go = process.env.GO_BINARY || path.join(sourceRoot, 'work/toolchains/go/bin/go');
  try { await fs.access(go); } catch { go = 'go'; }
  await run(go, ['build', '-trimpath', '-ldflags=-s -w', '-o', path.join(bundle, 'runtime', platform === 'win32' ? 'canvas-api.exe' : 'canvas-api'), '.'], { env: { ...process.env, TMPDIR: path.join(sourceRoot, 'work/tmp'), GOPATH: path.join(sourceRoot, 'work/cache/go'), GOCACHE: path.join(sourceRoot, 'work/cache/go-build'), CGO_ENABLED: '0', GOOS: platform === 'win32' ? 'windows' : 'linux', GOARCH: 'amd64' } });
  await fs.rm(path.join(bundle, 'web'), { recursive: true, force: true });
  await fs.cp(path.join(sourceRoot, 'web/.next/standalone'), path.join(bundle, 'web'), { recursive: true, dereference: true });
  await fs.cp(path.join(sourceRoot, 'web/.next/static'), path.join(bundle, 'web/.next/static'), { recursive: true });
  await fs.cp(path.join(sourceRoot, 'web/public'), path.join(bundle, 'web/public'), { recursive: true, filter: name => path.basename(name) !== 'director' });
  const director = path.join(bundle, 'integrations/cozyclay');
  await fs.mkdir(director, { recursive: true });
  await fs.rm(path.join(director, 'dist'), { recursive: true, force: true });
  for (const name of ['src', 'bin', 'mcp', 'dist', 'LICENSES', 'LICENSE', 'LICENSING.md', 'THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES_VIBE_WORKFLOW.md', 'package.json', 'package-lock.json']) await copy(path.join(sourceRoot, 'integrations/cozyclay', name), path.join(director, name), ['media']);
  if (!process.argv.includes('--reuse-deps')) await run('npm', ['ci', '--prefix', director, '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund']);
  await fs.cp(path.join(sourceRoot, 'integrations/cozyclay/node_modules/three'), path.join(director, 'node_modules/three'), { recursive: true });
  if (!process.argv.includes('--reuse-deps')) await run('npm', ['ci', '--prefix', path.join(director, 'mcp'), '--ignore-scripts', '--no-audit', '--no-fund']);
  await fs.mkdir(path.join(bundle, 'launcher'), { recursive: true });
  await fs.copyFile(path.join(sourceRoot, 'launcher/cozy-runtime.mjs'), path.join(bundle, 'launcher/cozy-runtime.mjs'));
  await fs.copyFile(path.join(sourceRoot, 'launcher/web-runtime.cjs'), path.join(bundle, 'launcher/web-runtime.cjs'));
  await fs.copyFile(path.join(sourceRoot, 'LICENSE'), path.join(bundle, 'LICENSE'));
  await fs.copyFile(path.join(sourceRoot, 'launcher/SOURCE-NOTICE.txt'), path.join(bundle, 'SOURCE-NOTICE.txt'));
  await fs.writeFile(path.join(bundle, 'bundle-manifest.json'), JSON.stringify({ format: 1, version: appVersion, files: await fileManifest(bundle, ['bundle-manifest.json']) }));
  return bundle;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(await prepareBundle(process.argv.includes('--windows') ? 'win32' : 'linux'));
