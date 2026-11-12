const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { NativePicker } = require('../lib/native-picker.cjs');
const http = require('node:http');

(async () => {
  const root = path.resolve(__dirname, '../..');
  const directory = await fs.mkdtemp(path.join(root, 'work/tmp/native-picker-'));
  await fs.mkdir(path.join(directory, 'logs'), { recursive: true });
  const packaged = process.argv.includes('--packaged');
  const executable = packaged ? path.join(root, 'work/packaged/画布工作台启动器-win32-x64/画布工作台启动器.exe') : require('electron');
  const entry = packaged ? path.join(path.dirname(executable), 'resources/app/main.cjs') : path.join(root, 'launcher/main.cjs');
  let app;
  let uploaded;
  const server = http.createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    uploaded = { authorization: request.headers.authorization, type: request.headers['content-type'], body: Buffer.concat(chunks).toString('utf8') };
    response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ code: 0 }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const picker = new NativePicker({ executable, entry, dataDir: directory });
  try {
    app = await electron.launch({ executablePath: executable, args: ['--no-sandbox', entry], env: { ...process.env, TMPDIR: path.join(root, 'work/tmp'), CANVAS_NATIVE_PICKER: '1', CANVAS_PICKER_DATA: directory, CANVAS_PICKER_OPTIONS: JSON.stringify({ title: '文件选择回归验证', properties: ['openFile'] }) } });
    await app.firstWindow();
    const state = await app.evaluate(({ BrowserWindow }) => { const owner = BrowserWindow.getAllWindows()[0]; return { title: owner.getTitle(), visible: owner.isVisible(), top: owner.isAlwaysOnTop() }; });
    assert.deepEqual(state, { title: '文件选择回归验证', visible: true, top: true });
    const result = await app.evaluate(async ({ net }, url) => {
      const form = new FormData(); form.set('file', new Blob(['reference-pixels'], { type: 'image/png' }), '衣服.png');
      return (await net.fetch(url, { method: 'POST', credentials: 'omit', headers: { authorization: 'Bearer test-only-key' }, body: form })).json();
    }, `http://127.0.0.1:${server.address().port}/upload`);
    assert.equal(result.code, 0);
    assert.equal(uploaded.authorization, 'Bearer test-only-key');
    assert.match(uploaded.type, /^multipart\/form-data/); assert.match(uploaded.body, /reference-pixels/);
    console.log('PASS Chromium network sends a real multipart reference image using the configured authorization');
    await app.evaluate(({ app }) => app.exit(0));
    console.log('PASS real Electron dialog has a visible topmost owner');
    for (const property of ['openDirectory', 'openFile']) {
      const selected = picker.select({ title: '选择中文素材', properties: [property] });
      await delay(1500);
      assert.ok(picker.active?.child.pid);
      await picker.cancel();
      assert.deepEqual(await selected, []);
      assert.equal(picker.active, null);
    }
    console.log('PASS cancel a real directory dialog and then a real file dialog without restarting the launcher');
  } finally {
    await picker.cancel(); await app?.close().catch(() => {});
    await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
