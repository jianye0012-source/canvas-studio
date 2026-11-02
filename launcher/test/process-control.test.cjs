const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Runtime } = require('../lib/runtime.cjs');
const { alive } = require('../lib/process-control.cjs');

const store = { dataDir: path.resolve(__dirname, '../../work/tmp'), value: { channels: [] } };
async function running(pid) {
  try { process.kill(pid, 0); if (process.platform === 'linux') return !(await fs.readFile(`/proc/${pid}/stat`, 'utf8')).match(/\) Z /); return true; } catch { return false; }
}
test('强制停止只终止本启动器管理的进程树，保留无关进程，可重新创建服务', async t => {
  const runtime = new Runtime({ store, root: store.dataDir });
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  t.after(async () => { unrelated.kill('SIGKILL'); await runtime.forceStop(); });
  const script = `const {spawn}=require('node:child_process');process.on('SIGTERM',()=>{});const child=spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{stdio:'ignore'});process.send({grandchild:child.pid});setInterval(()=>{},1000);`;
  const child = runtime.launch(process.execPath, ['-e', script], process.env, '测试服务');
  const [{ grandchild }] = await once(child, 'message');
  assert.ok(alive(child)); assert.ok(await running(grandchild));
  assert.equal(runtime.status().processes[0].pid, child.pid);
  await runtime.forceStop();
  assert.equal(runtime.status().phase, 'stopped'); assert.deepEqual(runtime.status().processes, []);
  for (let i = 0; i < 20 && await running(grandchild); i++) await delay(100);
  assert.equal(await running(grandchild), false); assert.equal(await running(unrelated.pid), true);
  runtime.startController = new AbortController();
  const another = runtime.launch(process.execPath, ['-e', 'setInterval(()=>{},1000)'], process.env, '重新启动测试');
  await once(another, 'spawn'); await runtime.forceStop(); assert.equal(alive(another), false);
});

test('启动检查卡住时可以立即取消，不会在停止后继续生成后台进程', async () => {
  const runtime = new Runtime({ store, root: store.dataDir });
  runtime.check = () => new Promise(() => {});
  const start = runtime.start({ open: false }); const stopped = assert.rejects(start, /强制停止/);
  const before = Date.now(); await runtime.forceStop(); await stopped;
  assert.ok(Date.now() - before < 2000); assert.equal(runtime.status().phase, 'stopped'); assert.equal(runtime.children.length, 0);
});
