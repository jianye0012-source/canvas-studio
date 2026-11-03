const fs = require('node:fs/promises');
const path = require('node:path');
const { atomicJson, writableDirectory } = require('./files.cjs');

const editorIdPattern = /^[a-zA-Z0-9_-]{1,160}$/;
class ProjectEditors {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.editors = new Map();
    this.watchers = new Map();
    this.pending = new Map();
    this.progress = new Map();
    this.claims = new Map();
  }
  connect(projectId, id, res) {
    const watchers = this.watchers.get(projectId) || new Set();
    this.watchers.set(projectId, watchers);
    const owner = !this.editors.has(projectId) && !this.pending.get(projectId);
    if (owner) this.editors.set(projectId, id);
    watchers.add(res);
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
    res.write(`event: access\ndata: ${JSON.stringify({ owner, progress: this.progress.get(projectId) })}\n\n`);
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
    heartbeat.unref();
    res.once('close', () => {
      clearInterval(heartbeat);
      watchers.delete(res);
      if (!watchers.size) this.watchers.delete(projectId);
      if (owner && this.editors.get(projectId) === id) {
        this.editors.delete(projectId);
        this.report(projectId, null);
      }
    });
  }
  canWrite(projectId, id) {
    const owner = this.editors.get(projectId);
    return owner ? owner === id : !id;
  }
  track(projects, res) {
    for (const id of projects) this.pending.set(id, (this.pending.get(id) || 0) + 1);
    res.once('close', () => {
      for (const id of projects) {
        const count = this.pending.get(id) - 1;
        if (count) this.pending.set(id, count); else this.pending.delete(id);
      }
    });
  }
  report(projectId, progress) {
    if (progress) this.progress.set(projectId, progress); else this.progress.delete(projectId);
    for (const res of this.watchers.get(projectId) || []) res.write(`event: progress\ndata: ${JSON.stringify(progress)}\n\n`);
  }
  async claim(projectId, owner, nodeId, attempt) {
    if (!this.canWrite(projectId, owner) || !owner) throw new Error('编辑权限已失效，请重新打开画布');
    if (typeof nodeId !== 'string' || typeof attempt !== 'string' || !editorIdPattern.test(nodeId) || !editorIdPattern.test(attempt)) throw new Error('循环任务编号无效');
    const key = nodeId + ':' + attempt;
    const previous = this.claims.get(projectId) || Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      await writableDirectory(this.dataDir);
      const file = path.join(this.dataDir, 'projects', 'loop-claims', projectId + '.json');
      const data = await fs.readFile(file, 'utf8').then(JSON.parse, error => { if (error.code !== 'ENOENT') throw error; return {}; });
      if (Object.hasOwn(data, key)) throw new Error('当前步骤已经登记提交。请核对任务记录，确认后再使用“重试当前步骤”');
      data[key] = Date.now();
      await atomicJson(file, data);
      if (!this.canWrite(projectId, owner)) throw new Error('编辑窗口已关闭，已停止发送任务');
    });
    this.claims.set(projectId, next);
    try { await next; } finally { if (this.claims.get(projectId) === next) this.claims.delete(projectId); }
  }
}
module.exports = { ProjectEditors, editorIdPattern };
