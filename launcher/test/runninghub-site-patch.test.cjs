const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { applyRunningHubPatch } = require('../lib/runninghub-site-patch.cjs');

const files = ['lib/runninghub-standard.cjs', 'lib/config.cjs', 'lib/gateway.cjs', 'main.cjs', 'ui/app.js', 'ui/index.html'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

async function fixture(t) {
  const root = await fs.mkdtemp(path.resolve(__dirname, '../../work/tmp/site-patch-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, '安装目录 中文');
  const payload = path.join(root, '补丁');
  const entries = [], records = [];
  for (const name of files) {
    const before = Buffer.from('original ' + name), after = Buffer.from('patched ' + name);
    const target = path.join(directory, 'resources/app', name);
    const source = path.join(payload, 'payload/1.3.11', name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.mkdir(path.dirname(source), { recursive: true });
    await fs.writeFile(target, before);
    await fs.writeFile(source, after);
    entries.push({ path: name, before: [digest(before)], after: digest(after) });
    records.push({ path: 'resources/app/' + name, size: before.length, sha256: digest(before) });
  }
  await fs.writeFile(path.join(directory, 'package-manifest.json'), JSON.stringify({ application: 'canvas-studio', platform: 'win32-x64', version: '1.3.11', files: records }));
  await fs.writeFile(path.join(payload, 'patch.json'), JSON.stringify({ versions: { '1.3.11': entries } }));
  return { directory, payload };
}

test('国内站补丁支持中文路径和重复应用，并同步完整性清单', async t => {
  const { directory, payload } = await fixture(t);
  assert.equal(await applyRunningHubPatch(directory, payload), '1.3.11');
  assert.equal(await applyRunningHubPatch(directory, payload), '1.3.11');
  const manifest = JSON.parse(await fs.readFile(path.join(directory, 'package-manifest.json'), 'utf8'));
  for (const entry of manifest.files) {
    const bytes = await fs.readFile(path.join(directory, entry.path));
    assert.equal(entry.sha256, digest(bytes));
    assert.equal(entry.size, bytes.length);
  }
});

test('国内站补丁在发现原文件或补丁被修改时整体拒绝应用', async t => {
  const { directory, payload } = await fixture(t);
  const first = path.join(directory, 'resources/app', files[0]);
  const original = await fs.readFile(first);
  const other = path.join(directory, 'resources/app', files.at(-1));
  await fs.writeFile(other, 'user change');
  await assert.rejects(() => applyRunningHubPatch(directory, payload), /与官方版本或本补丁不符/);
  assert.deepEqual(await fs.readFile(first), original);
});

test('国内站补丁在上次进程中断、文件仅替换一部分时可以继续应用', async t => {
  const { directory, payload } = await fixture(t);
  const name = files[0];
  await fs.copyFile(path.join(payload, 'payload/1.3.11', name), path.join(directory, 'resources/app', name));
  assert.equal(await applyRunningHubPatch(directory, payload), '1.3.11');
  for (const file of files) assert.equal(await fs.readFile(path.join(directory, 'resources/app', file), 'utf8'), 'patched ' + file);
});

test('国内站补丁写入清单失败时恢复所有已替换文件', async t => {
  const { directory, payload } = await fixture(t);
  const manifestFile = path.join(directory, 'package-manifest.json');
  const original = await fs.readFile(manifestFile);
  const rename = fs.rename;
  t.mock.method(fs, 'rename', async (from, to) => {
    if (to === manifestFile) throw new Error('模拟磁盘写入失败');
    return rename(from, to);
  });
  await assert.rejects(() => applyRunningHubPatch(directory, payload), /模拟磁盘写入失败/);
  assert.deepEqual(await fs.readFile(manifestFile), original);
  for (const name of files) assert.equal(await fs.readFile(path.join(directory, 'resources/app', name), 'utf8'), 'original ' + name);
});
