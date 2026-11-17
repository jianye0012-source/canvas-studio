import assert from 'node:assert/strict';
import { createOutputRequests } from '../src/canvas-output-request.js';

function clock() {
  let now = 0, next = 0;
  const timers = new Map();
  return {
    set: (callback, delay) => { const id = ++next; timers.set(id, { at: now + delay, callback }); return id; },
    clear: id => timers.delete(id),
    advance: delay => { now += delay; for (const [id, timer] of timers) if (timer.at <= now) { timers.delete(id); timer.callback(); } },
    count: () => timers.size,
  };
}

{
  const time = clock(), sent = [];
  const outputs = createOutputRequests({ post: (type, payload) => sent.push([type, payload]), setTimer: time.set, clearTimer: time.clear, makeId: () => 'request-1' });
  const result = outputs.send('storyai:director-video-sent', { blob: 'video' });
  assert.deepEqual(sent, [['storyai:director-video-sent', { blob: 'video', requestId: 'request-1' }]]);
  time.advance(15000);
  await assert.rejects(result, /画布未响应，请确认画布页面仍然打开后重试/);
  console.log('PASS 15 秒内未收到 accepted 时结束等待');
}

{
  const time = clock(); let label = '', settled = false;
  const outputs = createOutputRequests({ post() {}, onAccepted: () => { label = '画布正在保存…'; }, setTimer: time.set, clearTimer: time.clear, makeId: () => 'request-2' });
  const result = outputs.send('storyai:director-video-sent', {});
  result.then(() => { settled = true; });
  time.advance(14000); outputs.receive('storyai:director-output-accepted', { requestId: 'request-2' });
  assert.equal(label, '画布正在保存…'); assert.equal(time.count(), 0);
  time.advance(200000); await Promise.resolve(); assert.equal(settled, false);
  outputs.receive('storyai:director-output-result', { requestId: 'request-2', ok: true });
  await result; assert.equal(settled, true);
  console.log('PASS accepted 后等待 200 秒的最终结果仍可成功');
}

{
  const time = clock();
  const outputs = createOutputRequests({ post() {}, setTimer: time.set, clearTimer: time.clear, makeId: () => 'request-3' });
  const result = outputs.send('storyai:director-captures-sent', {});
  outputs.receive('storyai:director-output-accepted', { requestId: 'request-3' });
  outputs.receive('storyai:director-output-result', { requestId: 'request-3', ok: false, error: '保存失败' });
  await assert.rejects(result, /保存失败/);
  const closing = outputs.send('storyai:director-video-sent', {});
  outputs.close(); await assert.rejects(closing, /导演台已关闭/);
  console.log('PASS 截图回传失败原因与关闭时的等待结果');
}
