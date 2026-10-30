import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createRequire } from 'node:module';
import { sourceRoot, appVersion, run, prepareBundle, fileManifest } from './prepare-bundle.mjs';
import { packager } from '@electron/packager';
import archiver from 'archiver';
import unzipper from 'unzipper';

const taskWork = path.join(sourceRoot, 'work'), outputs = path.join(sourceRoot, 'outputs');
process.env.ELECTRON_CACHE = path.join(taskWork, 'cache/electron'); process.env.TMPDIR = path.join(taskWork, 'tmp');
await fs.mkdir(outputs, { recursive: true });
await fs.mkdir(path.join(taskWork, 'tmp'), { recursive: true }); await fs.mkdir(path.join(taskWork, 'cache'), { recursive: true });
if (!process.argv.includes('--skip-build')) {
  await run(process.execPath, [path.join(sourceRoot, 'web/node_modules/next/dist/bin/next'), 'build', '--webpack'], { cwd: path.join(sourceRoot, 'web') });
  await run('npm', ['run', 'build', '--prefix', path.join(sourceRoot, 'integrations/cozyclay')]);
}
const bundle = await prepareBundle('win32');
await run('npm', ['install', '--prefix', path.join(taskWork, 'win-native'), '--ignore-scripts', '--force', '--no-audit', '--no-fund', '@img/sharp-win32-x64@0.34.5', '@next/swc-win32-x64-msvc@16.2.9']);
for (const name of ['@img/sharp-win32-x64', '@next/swc-win32-x64-msvc']) {
  await fs.cp(path.join(sourceRoot, 'work/win-native/node_modules', name), path.join(bundle, 'web/node_modules', name), { recursive: true });
}
// The exact Node release is verified against the publisher's SHA-256 list.
const nodeVersion = '24.22.1', nodeName = `node-v${nodeVersion}-win-x64.zip`;
const nodeArchive = path.join(taskWork, 'cache', nodeName);
const sums = await (await fetch(`https://nodejs.org/dist/v${nodeVersion}/SHASUMS256.txt`)).text();
const expected = sums.split('\n').find(line => line.endsWith('  ' + nodeName))?.split(' ')[0];
if (!expected) throw new Error('Node 官方校验值缺失');
try { await fs.access(nodeArchive); } catch { const response = await fetch(`https://nodejs.org/dist/v${nodeVersion}/${nodeName}`); if (!response.ok) throw new Error('Node 下载失败'); await pipeline(response.body, createWriteStream(nodeArchive)); }
const hash = crypto.createHash('sha256'); for await (const chunk of createReadStream(nodeArchive)) hash.update(chunk);
if (hash.digest('hex') !== expected) throw new Error('Node 运行环境校验失败');
const nodeZip = await unzipper.Open.file(nodeArchive), nodeEntry = nodeZip.files.find(entry => entry.path.endsWith('/node.exe'));
await pipeline(nodeEntry.stream(), createWriteStream(path.join(bundle, 'runtime/node.exe')));

const app = path.join(taskWork, 'launcher-app'); await fs.rm(app, { recursive: true, force: true }); await fs.mkdir(app, { recursive: true });
for (const name of ['main.cjs', 'preload.cjs', 'ui', 'lib', 'package.json', 'package-lock.json', 'update-source.json']) await fs.cp(path.join(sourceRoot, 'launcher', name), path.join(app, name), { recursive: true });
await run('npm', ['ci', '--prefix', app, '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund']);
const paths = await packager({ dir: app, out: path.join(taskWork, 'packaged'), name: '画布工作台启动器', executableName: '画布工作台启动器', platform: 'win32', arch: 'x64', electronVersion: '45.1.0', appVersion, overwrite: true, asar: false, prune: false, tmpdir: path.join(taskWork, 'tmp'), download: { cacheRoot: path.join(taskWork, 'cache/electron') }, win32metadata: { ProductName: '画布工作台启动器', FileDescription: '本地画布与动态白模创作工作台', CompanyName: 'Canvas Studio' } });
const packaged = paths[0]; await fs.cp(bundle, path.join(packaged, 'resources/bundle'), { recursive: true });
await fs.copyFile(path.join(sourceRoot, 'launcher/使用说明.txt'), path.join(packaged, '使用说明.txt'));
async function zip(output, populate) { const writer = createWriteStream(output); const archive = archiver('zip', { zlib: { level: 6 } }); const finished = new Promise((resolve, reject) => { writer.once('close', resolve); writer.once('error', reject); archive.once('error', reject); }); archive.pipe(writer); populate(archive); await archive.finalize(); await finished; }
await zip(path.join(packaged, '对应源码.zip'), archive => archive.glob('**/*', { cwd: sourceRoot, dot: true, ignore: ['.git/**', '.agents/**', '**/node_modules/**', '**/.next/**', 'work/**', 'outputs/**', '**/dist/**', '**/*.log', '**/*.tsbuildinfo'] }));
await fs.writeFile(path.join(packaged, 'resources/bundle/bundle-manifest.json'), JSON.stringify({ format: 1, version: appVersion, files: await fileManifest(path.join(packaged, 'resources/bundle'), ['bundle-manifest.json']) }));
await fs.writeFile(path.join(packaged, 'package-manifest.json'), JSON.stringify({ application: 'canvas-studio', format: 1, platform: 'win32-x64', version: appVersion, files: await fileManifest(packaged, ['package-manifest.json']) }));
const output = path.join(outputs, `CanvasStudio-Windows-x64-${appVersion}.zip`);
await zip(output, archive => archive.directory(packaged, '画布工作台'));
const digest = crypto.createHash('sha256'); for await (const chunk of createReadStream(output)) digest.update(chunk);
await fs.writeFile(output + '.sha256', digest.digest('hex') + '  ' + path.basename(output) + '\n');
console.log(output);
