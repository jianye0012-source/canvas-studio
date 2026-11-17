import assert from 'node:assert/strict';
import { createSaveQueue } from '../src/canvas-save-queue.js';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};

{
  const firstGate = deferred();
  const secondGate = deferred();
  const secondStarted = deferred();
  let state = 0;
  const writes = [];
  const save = createSaveQueue(async force => {
    writes.push({ state, force });
    if (writes.length === 2) secondStarted.resolve();
    await (writes.length === 1 ? firstGate.promise : secondGate.promise);
  });
  const first = save();
  await Promise.resolve();
  const pending = Array.from({ length: 10 }, (_, index) => {
    state = index + 1;
    return save(index === 5);
  });
  assert.ok(pending.every(promise => promise === pending[0]));
  firstGate.resolve(); await first; await secondStarted.promise;
  assert.deepEqual(writes, [{ state: 0, force: false }, { state: 10, force: true }]);
  let settled = false;
  pending[0].then(() => { settled = true; });
  await Promise.resolve(); assert.equal(settled, false);
  secondGate.resolve(); await Promise.all(pending);
  assert.equal(settled, true);
  console.log('PASS 执行中只合并一次待保存，force 合并且读取最新状态，await 等待写盘');
}

{
  let calls = 0;
  const save = createSaveQueue(async () => { if (++calls === 1) throw new Error('磁盘保存失败'); });
  const first = save().then(() => null, error => error.message);
  const second = save();
  assert.equal(await first, '磁盘保存失败');
  await second; await save();
  assert.equal(calls, 3);
  console.log('PASS 首次保存失败不阻塞待保存及后续保存');
}

{
  const gate = deferred(); let canceled = false, writes = 0;
  const save = createSaveQueue(async () => { if (canceled) return; writes++; if (writes === 1) await gate.promise; });
  const first = save(); await Promise.resolve(); const second = save();
  canceled = true; gate.resolve(); await Promise.all([first, second]);
  assert.equal(writes, 1);
  console.log('PASS 取消后不再开始保存');
}

{
  let current = 'scene-1', last = 'scene-1', puts = 0;
  const save = createSaveQueue(async force => {
    const before = current;
    if (!force && before === last) return;
    puts++; last = before;
  });
  await save(); assert.equal(puts, 0);
  current = 'scene-2'; await save(); assert.equal(puts, 1);
  await save(); assert.equal(puts, 1);
  console.log('PASS 快照未变时跳过保存，场景变化时先写入');
}

{
  let last = '', puts = 0;
  const save = createSaveQueue(async () => {
    const before = 'scene';
    if (before === last) return;
    puts++;
    if (puts === 1) throw new Error('磁盘保存失败');
    last = before;
  });
  await assert.rejects(save(), /磁盘保存失败/);
  await save(); assert.equal(puts, 2); assert.equal(last, 'scene');
  console.log('PASS 首次 PUT 失败后快照未更新，下次调用仍会保存');
}
