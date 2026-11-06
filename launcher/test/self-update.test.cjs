const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { prepareSelfUpdate, applySelfUpdate, markUpdateReady } = require('../lib/self-update.cjs');

async function fixture(t) {
  const temporary = await fs.mkdtemp(path.resolve(__dirname, '../../work/tmp/self-update-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, '程序 中文'), dataDir = path.join(root, 'data'), staging = path.join(dataDir, 'updates', crypto.randomUUID());
  async function program(directory, version, extra) {
    const values = { '画布工作台启动器.exe': version, 'resources/bundle/runtime/node.exe': 'node', 'resources/app/ui/index.html': version, 'resources/app/lib/update.cjs': 'module.exports={clearInactiveVersions:async()=>0}', ...extra };
    const files = [];
    for (const [name, content] of Object.entries(values)) {
      const file = path.join(directory, name), bytes = Buffer.from(content);
      await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, bytes);
      files.push({ path: name, size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
    }
    await fs.writeFile(path.join(directory, 'package-manifest.json'), JSON.stringify({ application: 'canvas-studio', format: 1, updateProtocol: 2, platform: 'win32-x64', version, files }));
  }
  await program(root, '1.3.11', { 'old.dll': 'old' });
  await program(staging, '1.3.12', { 'new.dll': 'new' });
  await fs.mkdir(path.join(dataDir, 'logs'), { recursive: true });
  await fs.writeFile(path.join(dataDir, '项目.json'), '保留项目');
  await fs.writeFile(path.join(root, '用户说明.txt'), '保留额外文件');
  await fs.mkdir(path.join(root, '.versions'), { recursive: true });
  const pointer = { id: crypto.randomUUID(), version: '1.3.11' };
  await fs.writeFile(path.join(root, '.versions/active.json'), JSON.stringify(pointer));
  const jobFile = await prepareSelfUpdate(staging, root, dataDir);
  return { root, dataDir, staging, jobFile, pointer };
}

test('替换原目录程序、删除旧程序文件并确认界面成功，保留项目与额外文件', async t => {
  const { root, dataDir, jobFile, staging } = await fixture(t);
  let launched = 0;
  assert.equal(await applySelfUpdate(jobFile, { start: async (job, receipt) => {
    launched++; assert.ok(receipt);
    assert.equal(await fs.readFile(path.join(root, '画布工作台启动器.exe'), 'utf8'), '1.3.12');
    assert.equal(await fs.readFile(path.join(path.dirname(jobFile), 'previous/old.dll'), 'utf8'), 'old');
    await assert.rejects(fs.access(path.join(root, '.versions/active.json')), { code: 'ENOENT' });
    await markUpdateReady(jobFile, root, dataDir, '1.3.12', 123);
  } }), 'complete');
  assert.equal(launched, 1);
  assert.equal(await fs.readFile(path.join(dataDir, '项目.json'), 'utf8'), '保留项目');
  assert.equal(await fs.readFile(path.join(root, '用户说明.txt'), 'utf8'), '保留额外文件');
  await assert.rejects(fs.access(path.join(root, 'old.dll')), { code: 'ENOENT' });
  await assert.rejects(fs.access(staging), { code: 'ENOENT' });
  assert.equal(JSON.parse(await fs.readFile(path.join(dataDir, 'updates/last-install.json'))).success, true);
  assert.equal(await applySelfUpdate(jobFile), 'complete');
});

test('新版界面失败时恢复原启动器和活动版本，并重新打开旧程序', async t => {
  const { root, dataDir, jobFile, pointer } = await fixture(t);
  const launches = [];
  await assert.rejects(applySelfUpdate(jobFile, { start: async (_job, receipt) => {
    launches.push(receipt); if (receipt) throw new Error('模拟界面无法初始化');
    assert.equal(await fs.readFile(path.join(root, '画布工作台启动器.exe'), 'utf8'), '1.3.11');
  } }), /模拟界面无法初始化/);
  assert.deepEqual(launches, [true, false]);
  assert.equal(await fs.readFile(path.join(root, 'old.dll'), 'utf8'), 'old');
  await assert.rejects(fs.access(path.join(root, 'new.dll')), { code: 'ENOENT' });
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, '.versions/active.json'))), pointer);
  assert.equal(await fs.readFile(path.join(dataDir, '项目.json'), 'utf8'), '保留项目');
});

test('替换中磁盘写入失败时自动恢复，不留下半套启动器', async t => {
  const { root, jobFile } = await fixture(t);
  const rename = fs.rename; let failed = false;
  t.mock.method(fs, 'rename', async (from, to) => {
    if (to === path.join(root, 'new.dll') && !failed) { failed = true; throw new Error('模拟写入失败'); }
    return rename(from, to);
  });
  await assert.rejects(applySelfUpdate(jobFile, { start: async () => {} }), /模拟写入失败/);
  assert.equal(await fs.readFile(path.join(root, '画布工作台启动器.exe'), 'utf8'), '1.3.11');
  assert.equal(await fs.readFile(path.join(root, 'old.dll'), 'utf8'), 'old');
});

test('更新中断后可按事务记录恢复原文件', async t => {
  const { root, jobFile } = await fixture(t);
  await assert.rejects(applySelfUpdate(jobFile, { start: async (_job, receipt) => { if (receipt) throw new Error('失败'); } }));
  await fs.writeFile(path.join(path.dirname(jobFile), 'state.json'), JSON.stringify({ phase: 'replacing' }));
  await fs.writeFile(path.join(root, '画布工作台启动器.exe'), '半套程序');
  await assert.rejects(applySelfUpdate(jobFile, { start: async () => {} }), /上次更新中断/);
  assert.equal(await fs.readFile(path.join(root, '画布工作台启动器.exe'), 'utf8'), '1.3.11');
});

test('拒绝损坏包、额外文件冲突与伪造界面回执，原程序不变', async t => {
  const { root, dataDir, jobFile } = await fixture(t);
  await fs.writeFile(path.join(root, 'new.dll'), '用户自己的文件');
  await assert.rejects(applySelfUpdate(jobFile, { start: async () => {} }), /现有额外文件冲突/);
  assert.equal(await fs.readFile(path.join(root, 'new.dll'), 'utf8'), '用户自己的文件');
  await fs.rm(path.join(root, 'new.dll'));
  await fs.rm(path.join(path.dirname(jobFile), 'state.json'));
  await fs.writeFile(path.join(path.dirname(jobFile), 'next/new.dll'), '损坏');
  await assert.rejects(applySelfUpdate(jobFile, { start: async () => {} }), /文件大小不匹配|文件校验失败/);
  await assert.rejects(markUpdateReady(jobFile, root, dataDir, '9.9.9'), /校验不匹配/);
  assert.equal(await fs.readFile(path.join(root, '画布工作台启动器.exe'), 'utf8'), '1.3.11');
});

test('相同运行时即使被外部 MCP 占用也不替换或回滚覆盖', async t => {
  const { root, jobFile } = await fixture(t);
  const rename = fs.rename;
  t.mock.method(fs, 'rename', async (from, to) => {
    if (to === path.join(root, 'resources/bundle/runtime/node.exe')) throw new Error('不应写入未变化的运行时');
    return rename(from, to);
  });
  await assert.rejects(applySelfUpdate(jobFile, { start: async (_job, receipt) => { if (receipt) throw new Error('模拟新版失败'); } }), /模拟新版失败/);
  assert.equal(await fs.readFile(path.join(root, 'resources/bundle/runtime/node.exe'), 'utf8'), 'node');
  await assert.rejects(fs.access(path.join(path.dirname(jobFile), 'previous/resources/bundle/runtime/node.exe')), { code: 'ENOENT' });
});

test('变化的运行时被占用而未能替换时，回滚保留原文件并恢复其他程序', async t => {
  const { root, jobFile } = await fixture(t);
  const job = JSON.parse(await fs.readFile(jobFile));
  const changed = Buffer.from('new-node');
  Object.assign(job.next.files.find(entry => entry.path === 'resources/bundle/runtime/node.exe'), { size: changed.length, sha256: crypto.createHash('sha256').update(changed).digest('hex') });
  await fs.writeFile(path.join(path.dirname(jobFile), 'next/resources/bundle/runtime/node.exe'), changed);
  await fs.writeFile(path.join(path.dirname(jobFile), 'next/package-manifest.json'), JSON.stringify(job.next));
  await fs.writeFile(jobFile, JSON.stringify(job));
  const rename = fs.rename, rm = fs.rm;
  t.mock.method(fs, 'rename', async (from, to) => {
    if (to === path.join(root, 'resources/bundle/runtime/node.exe')) throw new Error('模拟运行时被占用');
    return rename(from, to);
  });
  t.mock.method(fs, 'rm', async (file, options) => {
    assert.notEqual(file, path.join(root, 'resources/bundle/runtime/node.exe'), '回滚不能删除仍然是原内容的运行时');
    return rm(file, options);
  });
  await assert.rejects(applySelfUpdate(jobFile, { start: async () => {} }), /模拟运行时被占用/);
  assert.equal(await fs.readFile(path.join(root, 'resources/bundle/runtime/node.exe'), 'utf8'), 'node');
  assert.equal(await fs.readFile(path.join(root, '画布工作台启动器.exe'), 'utf8'), '1.3.11');
});
