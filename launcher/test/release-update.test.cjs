const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const archiver = require('archiver');
const { createWriteStream } = require('node:fs');
const { ReleaseUpdater } = require('../lib/release-update.cjs');
const source = { owner: 'jianye0012-source', repository: 'canvas-studio' };

async function fixture(t, { corrupt = false, prerelease = false } = {}) {
  const dataDir = await fs.mkdtemp(path.resolve(__dirname, '../../work/tmp/update-test-')); t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const version = prerelease ? '1.3.0-beta.1' : '1.3.0', name = `画布工作台-Windows-x64-${version}.zip`;
  const files = [{ path: '画布工作台启动器.exe', bytes: Buffer.from('MZ-launcher') }, { path: 'resources/bundle/runtime/node.exe', bytes: Buffer.from('MZ-node') }];
  const manifest = { application: 'canvas-studio', format: 1, platform: 'win32-x64', version, files: files.map(file => ({ path: file.path, size: file.bytes.length, sha256: crypto.createHash('sha256').update(file.bytes).digest('hex') })) };
  const fixtureZip = path.join(dataDir, 'fixture.zip');
  const writer = createWriteStream(fixtureZip), archive = archiver('zip');
  const done = new Promise((resolve, reject) => { writer.on('close', resolve); archive.on('error', reject); }); archive.pipe(writer);
  for (const file of files) archive.append(file.bytes, { name: '画布工作台/' + file.path });
  archive.append(JSON.stringify(manifest), { name: '画布工作台/package-manifest.json' }); await archive.finalize(); await done;
  const bytes = await fs.readFile(fixtureZip), expected = crypto.createHash('sha256').update(bytes).digest('hex');
  const base = `https://github.com/${source.owner}/${source.repository}/releases/download/v${version}/`;
  const zipUrl = base + encodeURIComponent(name), shaUrl = base + encodeURIComponent(name + '.sha256');
  const release = { tag_name: 'v' + version, body: '测试发布说明', prerelease, draft: false, assets: [{ name, size: bytes.length, digest: 'sha256:' + expected, browser_download_url: zipUrl }, { name: name + '.sha256', size: 130, browser_download_url: shaUrl }] };
  let downloads = 0;
  const fetchImpl = async url => {
    if (url.endsWith('/releases/latest')) return Response.json(release);
    if (url === shaUrl) return new Response(expected + '  ' + name + '\n');
    if (url === zipUrl) { downloads++; return new Response(corrupt ? Buffer.alloc(bytes.length, 0) : bytes); }
    throw new Error('Unexpected URL: ' + url);
  };
  const updater = new ReleaseUpdater({ dataDir, currentVersion: '1.2.0', source, fetchImpl }); t.after(() => updater.close());
  return { updater, dataDir, release, fetchImpl, downloads: () => downloads };
}

test('正式版检查、流式下载、双重校验及重启恢复待安装状态，复用已验证下载', async t => {
  const { updater, dataDir, fetchImpl, downloads } = await fixture(t);
  await updater.initialize(); assert.equal((await updater.check()).phase, 'available');
  const states = []; updater.on('status', value => states.push(value.phase));
  await updater.download(); assert.equal(updater.status().phase, 'ready'); assert.ok(states.includes('downloading')); assert.ok(states.includes('verifying'));
  assert.equal(downloads(), 1);
  const staged = await updater.installation(); assert.ok(staged.startsWith(path.join(dataDir, 'updates') + path.sep));
  const reopened = new ReleaseUpdater({ dataDir, currentVersion: '1.2.0', source, fetchImpl }); t.after(() => reopened.close());
  await reopened.initialize(); assert.equal(reopened.status().phase, 'ready'); assert.equal(await reopened.installation(), staged);
  await reopened.check(); await reopened.download(); assert.equal(downloads(), 1);
});

test('损坏下载被拒绝、清除中间文件，原程序与用户项目不被替换', async t => {
  const { updater, dataDir } = await fixture(t, { corrupt: true });
  await fs.writeFile(path.join(dataDir, '我的项目.json'), '{"saved":true}');
  await updater.check(); await assert.rejects(() => updater.download(), /SHA-256/);
  assert.equal(updater.status().phase, 'error'); assert.equal(await fs.readFile(path.join(dataDir, '我的项目.json'), 'utf8'), '{"saved":true}');
  assert.deepEqual(await fs.readdir(path.join(dataDir, 'updates/downloads')), []);
  await assert.rejects(() => updater.installation(), /先下载/);
});

test('拒绝预发行、外部下载地址与不一致摘要；断网和无发行版有明确状态', async t => {
  const early = await fixture(t, { prerelease: true }); await assert.rejects(() => early.updater.check(), /正式版本/);
  const other = await fixture(t); other.release.assets[0].browser_download_url = 'https://example.com/unknown.zip'; await assert.rejects(() => other.updater.check(), /本项目/);
  const inconsistent = await fixture(t); inconsistent.release.assets[0].digest = 'sha256:' + '0'.repeat(64); await assert.rejects(() => inconsistent.updater.check(), /摘要/);
  const offline = new ReleaseUpdater({ dataDir: other.dataDir, currentVersion: '1.2.0', source, fetchImpl: async () => { throw Error('网络不可用'); } }); t.after(() => offline.close());
  await assert.rejects(() => offline.check(), /网络不可用/); assert.equal(offline.status().phase, 'error');
  const empty = new ReleaseUpdater({ dataDir: other.dataDir, currentVersion: '1.2.0', source, fetchImpl: async () => new Response('', { status: 404 }) }); t.after(() => empty.close());
  assert.equal((await empty.check()).phase, 'current'); assert.match(empty.status().message, /尚无公开发行版/);
});

test('机械盘数据目录丢失时停止下载，不重新创建；升级到目标版本后不再安装旧包', async t => {
  const { updater, dataDir, fetchImpl } = await fixture(t);
  await updater.check(); await updater.download();
  const upgraded = new ReleaseUpdater({ dataDir, currentVersion: '1.3.0', source, fetchImpl }); t.after(() => upgraded.close());
  await upgraded.initialize(); assert.equal((await upgraded.check()).phase, 'current'); await assert.rejects(() => upgraded.installation(), /先下载/);
  const detached = dataDir + '-detached'; await fs.rename(dataDir, detached); t.after(() => fs.rm(detached, { recursive: true, force: true }));
  await assert.rejects(() => updater.download()); await assert.rejects(() => fs.stat(dataDir));
});
