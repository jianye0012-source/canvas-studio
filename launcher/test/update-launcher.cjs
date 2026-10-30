const { _electron: electron } = require('playwright-core');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const archiver = require('archiver');
const { createWriteStream } = require('node:fs');
(async () => {
  const root = path.resolve(__dirname, '../..'), taskRoot = await fs.mkdtemp(path.join(root, 'work/tmp/native-update-'));
  const version = '1.3.0', name = `画布工作台-Windows-x64-${version}.zip`, file = path.join(taskRoot, 'fixture.zip');
  const entries = [{ path: '画布工作台启动器.exe', data: 'MZ-launcher' }, { path: 'resources/bundle/runtime/node.exe', data: 'MZ-node' }];
  const manifest = { application: 'canvas-studio', format: 1, platform: 'win32-x64', version, files: entries.map(entry => ({ path: entry.path, size: Buffer.byteLength(entry.data), sha256: crypto.createHash('sha256').update(entry.data).digest('hex') })) };
  const writer = createWriteStream(file), archive = archiver('zip'), done = new Promise((resolve, reject) => { writer.on('close', resolve); archive.on('error', reject); }); archive.pipe(writer);
  for (const entry of entries) archive.append(entry.data, { name: '画布工作台/' + entry.path }); archive.append(JSON.stringify(manifest), { name: '画布工作台/package-manifest.json' }); await archive.finalize(); await done;
  const hash = crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
  const launch = () => electron.launch({ executablePath: require('electron'), args: ['--no-sandbox', path.join(root, 'launcher')], env: { ...process.env, TMPDIR: path.join(root, 'work/tmp'), CANVAS_DEV_ROOT: taskRoot } });
  let app = await launch();
  try {
    let page = await app.firstWindow(); await page.locator('#browser-current').filter({ hasText: '已保存：' }).waitFor();
    await page.locator('[data-page="repair"]').click(); await page.locator('#auto-check-updates').uncheck();
    await page.waitForFunction(async () => !(await window.launcher.invoke('app:load')).config.autoCheckUpdates);
    await app.evaluate((_electron, input) => {
      const require = process.getBuiltinModule('module').createRequire(input.root + '/launcher/package.json');
      const { ReleaseUpdater } = require(input.root + '/launcher/lib/release-update.cjs');
      const original = ReleaseUpdater.prototype.checkInner;
      ReleaseUpdater.prototype.checkInner = async function () {
        this.fetchImpl = async url => {
          const base = 'https://github.com/jianye0012-source/canvas-studio/releases/download/v1.3.0/';
          if (url.endsWith('/releases/latest')) return Response.json({ tag_name: 'v1.3.0', body: '这是本地测试发行版，用于验证更新按钮与下载进度。', assets: [{ name: input.name, size: require('node:fs').statSync(input.file).size, digest: 'sha256:' + input.hash, browser_download_url: base + encodeURIComponent(input.name) }, { name: input.name + '.sha256', size: 130, browser_download_url: base + encodeURIComponent(input.name + '.sha256') }] });
          if (url.endsWith('.sha256')) return new Response(input.hash + '  ' + input.name + '\n');
          return new Response(require('node:fs').readFileSync(input.file));
        };
        return original.call(this);
      };
    }, { root, name, file, hash });
    await page.locator('#check-update').click(); await page.locator('#update-message').filter({ hasText: '发现新版本 1.3.0' }).waitFor();
    await page.locator('#download-update').click(); await page.locator('#update-message').filter({ hasText: '更新 1.3.0 已校验' }).waitFor();
    assert.equal(await page.locator('#install-update').isEnabled(), true);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1120, 1000));
    await page.screenshot({ path: path.join(root, 'outputs/更新框架预览.png') });
    await page.locator('#install-update').click(); await page.locator('#notice.error').filter({ hasText: 'Windows 整合包' }).waitFor();
    await app.close(); app = await launch(); page = await app.firstWindow();
    await page.locator('[data-page="repair"]').click(); await page.locator('#update-message').filter({ hasText: '更新 1.3.0 已校验' }).waitFor();
    assert.equal((await page.evaluate(() => window.launcher.invoke('app:load'))).update.phase, 'ready');
    const result = { passed: true, provider: '本地测试发行版；真实 Electron 界面', verified: ['在线检查按钮、发行说明及可用版本状态', '下载、SHA-256 校验、文件清单校验、待安装按钮状态', '关闭并重开后恢复已校验更新', '自动检查偏好保存', 'Linux 开发模式拒绝执行 Windows 安装'], remaining: ['真实 GitHub Releases 联调', 'Windows 重启安装实机验收'] };
    await fs.writeFile(path.join(root, 'outputs/更新框架联调结果.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
  } finally { await app.close(); await fs.rm(taskRoot, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exit(1); });
