const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Runtime } = require('../lib/runtime.cjs');
const { ConfigStore } = require('../lib/config.cjs');
const { browserExecutable } = require('../lib/browser.cjs');

(async () => {
  const root = path.resolve(__dirname, '../..');
  const task = await fs.mkdtemp(path.join(root, 'work/tmp/zip-'));
  const bundle = path.join(root, 'work', process.platform === 'win32' ? 'bundle-windows' : 'bundle-linux');
  const runtimes = [];
  try {
    const create = async name => {
      const location = path.join(task, name);
      await fs.mkdir(location);
      const store = await new ConfigStore(location).initialize();
      const runtime = new Runtime({ store, root: bundle, development: true });
      runtimes.push(runtime);
      runtime.on('log', lines => { if (/已就绪|Error|failed/.test(lines.at(-1) || '')) console.log(name, lines.at(-1)); });
      await runtime.start({ open: false });
      const file = path.join(task, name + '.json');
      await fs.writeFile(file, JSON.stringify({ url: runtime.gateway.origin, launchUrl: runtime.gateway.launchUrl(), dataDir: store.dataDir }));
      return file;
    };
    const source = await create('源工作区'), target = await create('目标工作区');
    const chrome = await browserExecutable({ browser: 'chrome' });
    const code = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(__dirname, 'browser-smoke.cjs')], {
        env: { ...process.env, CANVAS_RUNTIME_FILE: source, CANVAS_ARCHIVE_TARGET: target, CANVAS_BROWSER_EXE: chrome, CANVAS_TEST_OUTPUT: task },
        stdio: 'inherit',
      });
      child.once('error', reject); child.once('exit', resolve);
    });
    if (code !== 0) throw new Error('跨工作区画布 ZIP 验收失败');
  } finally {
    await Promise.allSettled(runtimes.map(runtime => runtime.stop()));
    await fs.rm(task, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
