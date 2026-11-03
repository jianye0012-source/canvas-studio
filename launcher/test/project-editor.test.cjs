const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const path = require('node:path');
const { ProjectEditors } = require('../lib/project-editor.cjs');

class Connection extends EventEmitter {
  chunks = [];
  writeHead() {}
  write(value) { this.chunks.push(value); }
}

test('第二个窗口仅接收进度，断开时等待正在保存的项目；循环步骤登记跨重启防重', async t => {
  const root = await fs.mkdtemp(path.resolve(__dirname, '../../work/tmp/edit-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const editors = new ProjectEditors(root);
  const editor = new Connection(), observer = new Connection();
  editors.connect('project-1', 'editor', editor);
  editors.connect('project-1', 'observer', observer);
  assert.match(editor.chunks[0], /"owner":true/);
  assert.match(observer.chunks[0], /"owner":false/);
  assert.equal(editors.canWrite('project-1', 'observer'), false);
  await assert.rejects(editors.claim('project-1', 'observer', 'node', 'first'), /编辑权限/);
  await editors.claim('project-1', 'editor', 'node', 'first');
  await assert.rejects(editors.claim('project-1', 'editor', 'node', 'first'), /已经登记/);
  editors.report('project-1', { index: 1, total: 2, state: 'running', file: '第二个视频.mp4' });
  assert.match(observer.chunks.at(-1), /第二个视频/);
  const saving = new Connection(), blocked = new Connection();
  editors.track(new Set(['project-1']), saving);
  editor.emit('close');
  editors.connect('project-1', 'blocked', blocked);
  assert.match(blocked.chunks[0], /"owner":false/);
  saving.emit('close');
  const reopened = new ProjectEditors(root), fresh = new Connection();
  reopened.connect('project-1', 'fresh', fresh);
  await assert.rejects(reopened.claim('project-1', 'fresh', 'node', 'first'), /已经登记/);
  await reopened.claim('project-1', 'fresh', 'node', 'explicit-retry');
  observer.emit('close'); blocked.emit('close'); fresh.emit('close');
});
