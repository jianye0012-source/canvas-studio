const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const unzipper = require('unzipper');

(async () => {
  const root = path.resolve(__dirname, '../..');
  const temporary = await fs.mkdtemp(path.join(root, 'work/tmp/site-patch-official-'));
  const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  try {
    const archive = await unzipper.Open.file(path.join(root, 'outputs/CanvasStudio-RunningHub-CN-Patch.zip'));
    await archive.extract({ path: temporary });
    const payload = path.join(temporary, 'RunningHub-CN-Patch');
    const { versions } = JSON.parse(await fs.readFile(path.join(payload, 'patch.json'), 'utf8'));
    const { applyRunningHubPatch } = require(path.join(payload, 'runninghub-site-patch.cjs'));
    for (const [version, entries] of Object.entries(versions)) for (const lineEnding of ['LF', 'CRLF']) {
      const directory = path.join(temporary, '安装 中文', version + lineEnding);
      const records = [];
      for (const entry of entries) {
        const original = execFileSync('git', ['show', `v${version}:launcher/${entry.path}`], { cwd: root });
        const bytes = lineEnding === 'CRLF' ? Buffer.from(original.toString('utf8').replace(/\r?\n/g, '\r\n')) : original;
        assert.ok(entry.before.includes(digest(bytes)));
        const file = path.join(directory, 'resources/app', entry.path);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, bytes);
        records.push({ path: 'resources/app/' + entry.path, sha256: digest(bytes), size: bytes.length });
      }
      const manifestFile = path.join(directory, 'package-manifest.json');
      await fs.writeFile(manifestFile, JSON.stringify({ application: 'canvas-studio', platform: 'win32-x64', version, files: records }));
      assert.equal(await applyRunningHubPatch(directory, payload), version);
      assert.equal(await applyRunningHubPatch(directory, payload), version);
      const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
      for (const record of manifest.files) {
        const bytes = await fs.readFile(path.join(directory, record.path));
        assert.equal(record.sha256, digest(bytes));
        assert.equal(record.size, bytes.length);
      }
      assert.match(await fs.readFile(path.join(directory, 'resources/app/ui/index.html'), 'utf8'), /国内站 .cn/);
      const holder = path.join(temporary, '活动版本 中文', version + lineEnding);
      const id = crypto.randomUUID();
      await fs.mkdir(path.join(holder, '.versions'), { recursive: true });
      await fs.rename(directory, path.join(holder, '.versions', id));
      await fs.writeFile(path.join(holder, '.versions/active.json'), JSON.stringify({ id }));
      await fs.writeFile(path.join(holder, '画布工作台启动器.exe'), 'fixture');
      await fs.mkdir(path.join(holder, 'data'));
      await fs.writeFile(path.join(holder, 'data/project.txt'), '保留项目与配置');
      const output = execFileSync(process.execPath, [path.join(payload, 'runninghub-site-patch.cjs'), holder], { cwd: root, encoding: 'utf8' });
      assert.match(output, /补丁已应用/);
      assert.equal(await fs.readFile(path.join(holder, 'data/project.txt'), 'utf8'), '保留项目与配置');
      console.log('PASS official ' + version + ' ' + lineEnding + ', Chinese paths, integrity, repeated apply, active installation and data preservation');
    }
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
