const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const path = require('node:path');
const { NativePicker } = require('../lib/native-picker.cjs');

function fixture(timeout = 1000) {
  const children = [];
  const picker = new NativePicker({
    executable: 'electron', entry: 'main.cjs', dataDir: path.resolve('work/tmp'), timeout,
    spawnImpl(_exe, _args, options) {
      const child = new EventEmitter();
      Object.assign(child, { pid: children.length + 1, exitCode: null, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), options });
      children.push(child); return child;
    },
    async stop(child) {
      if (child.exitCode !== null) return;
      child.exitCode = 0; child.emit('close', 0);
    },
  });
  return { picker, children };
}

test('文件夹选择未结束时重复点击只置前，取消后可以打开图片选择', async () => {
  const { picker, children } = fixture();
  const folder = picker.select({ properties: ['openDirectory'] });
  assert.deepEqual(await picker.select({ properties: ['openFile'] }), []);
  assert.equal(children.length, 1);
  assert.equal(children[0].stdin.read().toString(), 'focus\n');
  assert.equal(children[0].options.env.CANVAS_NATIVE_PICKER, '1');
  await picker.cancel(); assert.deepEqual(await folder, []);
  const image = picker.select({ properties: ['openFile'] });
  const selected = path.resolve('work/tmp/中文 衣服.png');
  const bytes = Buffer.from('CANVAS_PICKER_RESULT ' + JSON.stringify({ files: [selected] }) + '\n');
  for (const byte of bytes) children[1].stdout.write(Buffer.from([byte]));
  assert.deepEqual(await image, [selected]);
  assert.equal(picker.active, null);
});

test('选择进程启动失败和超时后均释放状态', async () => {
  const { picker, children } = fixture(20);
  const failed = picker.select({});
  children[0].emit('error', new Error('启动失败'));
  await assert.rejects(failed, /无法启动/); assert.equal(picker.active, null);
  await assert.rejects(picker.select({}), /等待超时/); assert.equal(picker.active, null);
  const retry = picker.select({});
  children[2].stdout.write('CANVAS_PICKER_RESULT {"files":[]}\n');
  assert.deepEqual(await retry, []);
});

test('正在取消旧窗口时新请求等待旧进程结束，不复用旧选择结果', async () => {
  const { picker, children } = fixture();
  const first = picker.select({});
  const cancelled = picker.cancel();
  const second = picker.select({});
  await cancelled; assert.deepEqual(await first, []);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(children.length, 2);
  children[1].stdout.write('CANVAS_PICKER_RESULT {"files":[]}\n');
  assert.deepEqual(await second, []);
});
