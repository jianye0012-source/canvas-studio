const fs = require('node:fs/promises');
const { createReadStream, createWriteStream } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { atomicJson, writableDirectory, requireFreeSpace } = require('./files.cjs');
const runningHub = require('./runninghub-standard.cjs');
const { parameters, imageFields } = require('./runninghub-schema.cjs');

const idPattern = /^[a-f0-9-]{36}$/;
const scenePattern = /^[a-zA-Z0-9_-]{1,160}$/;
const maxBytes = 100 * 1024 ** 2;
class Model3DTasks {
  constructor(store, { exporter, choose, log = () => {} } = {}) {
    Object.assign(this, { store, exporter, choose, log });
    this.root = path.join(store.dataDir, 'projects/model-3d');
    this.active = new Set(); this.operations = new Map(); this.unwritten = new Map(); this.controller = new AbortController();
    this.ready = this.restore();
    void this.ready.catch(error => log('3D 任务恢复失败：' + error.message));
    this.timer = setInterval(() => { void this.tick().catch(error => log('3D 任务：' + error.message)); }, 5000);
    this.timer.unref();
  }
  file(id, extension = 'json') { if (!idPattern.test(id)) throw new Error('3D 任务编号无效'); return path.join(this.root, id + '.' + extension); }
  async read(id) { this.file(id); const task = this.unwritten.get(id) || JSON.parse(await fs.readFile(this.file(id), 'utf8')); if (task.id !== id || task.format !== 1) throw new Error('3D 任务记录损坏'); return task; }
  async write(task) { if (task.taskId) this.unwritten.set(task.id, task); await writableDirectory(this.store.dataDir); await atomicJson(this.file(task.id), task); this.unwritten.delete(task.id); return task; }
  async restore() {
    const files = await fs.readdir(this.root).catch(error => { if (error.code !== 'ENOENT') throw error; return []; });
    for (const name of files.filter(name => /^[a-f0-9-]{36}\.json$/.test(name))) {
      try {
        const task = await this.read(name.slice(0, -5));
        if (!task.taskId && task.status === 'submitting') await this.write({ ...task, status: 'uncertain', error: '上次提交未能确认任务编号，请先核对平台记录，勿重复提交' });
        if (task.taskId && !['completed', 'failed'].includes(task.status)) this.active.add(task.id);
      }
      catch (error) { this.log('3D 任务记录无法读取：' + error.message); }
    }
  }
  models() {
    return this.store.value.channels.filter(channel => channel.enabled && channel.protocol === runningHub.protocol).flatMap(channel => channel.models.flatMap(model => {
      const spec = channel.runningHubModels?.[model];
      return spec?.type === '3d' ? [{ channelId: channel.id, model, label: `${channel.name} · ${spec.name}`, fields: Object.entries(spec.properties).map(([name, field]) => ({ name, ...field, media: imageFields.has(name), required: spec.required.includes(name) })) }] : [];
    }));
  }
  public(task) { const { requestHash, resultUrl, ...value } = task; return value; }
  async list(sceneId) {
    if (!scenePattern.test(sceneId)) throw new Error('导演台编号无效');
    await this.ready;
    const files = await fs.readdir(this.root).catch(error => { if (error.code !== 'ENOENT') throw error; return []; });
    const tasks = [];
    for (const name of files.filter(name => /^[a-f0-9-]{36}\.json$/.test(name))) {
      const task = await this.read(name.slice(0, -5)); if (task.sceneId === sceneId) tasks.push(this.public(task));
    }
    return tasks.sort((a, b) => b.createdAt - a.createdAt);
  }
  create(input) {
    this.file(input.id);
    if (this.operations.has(input.id)) return this.operations.get(input.id);
    const pending = this.createInner(input).finally(() => this.operations.delete(input.id));
    this.operations.set(input.id, pending); return pending;
  }
  async createInner(input) {
    await this.ready;
    this.controller.signal.throwIfAborted();
    if (!scenePattern.test(input.sceneId)) throw new Error('导演台编号无效');
    const channel = this.store.value.channels.find(channel => channel.id === input.channelId && channel.enabled);
    const spec = channel?.runningHubModels?.[input.model];
    if (channel?.protocol !== runningHub.protocol || spec?.type !== '3d' || !channel.models.includes(input.model)) throw new Error('请先检测渠道并添加可用的 3D 模型');
    if (!channel.apiKey) throw new Error('请先填写该渠道的 RunningHub API Key');
    const normalized = parameters(spec, input);
    const requestHash = crypto.createHash('sha256').update(JSON.stringify([input.sceneId, channel.id, input.model, normalized])).digest('hex');
    try { const previous = await this.read(input.id); if (previous.requestHash !== requestHash) throw new Error('同一任务编号不能用于不同的生成请求'); return this.public(previous); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const task = { format: 1, id: input.id, sceneId: input.sceneId, channelId: channel.id, channelName: channel.name, baseUrl: channel.baseUrl, model: input.model, name: spec.name, prompt: input.prompt || '', createdAt: Date.now(), status: 'submitting', requestHash };
    await this.write(task);
    try {
      const result = await runningHub.submit3D(channel, input, { fetchImpl: this.store.fetchImpl, signal: this.controller.signal });
      if (typeof result.taskId !== 'string' || !/^\d{1,32}$/.test(result.taskId)) {
        task.status = result.errorMessage ? 'failed' : 'uncertain';
        task.error = result.errorMessage || '提交状态不明确，请先核对 RunningHub 任务记录，勿重复提交';
      } else {
        task.taskId = result.taskId; task.status = 'processing';
        this.active.add(task.id);
      }
      try { await this.write(task); }
      catch (error) { throw new Error(`任务${task.taskId ? '已提交，服务商编号 ' + task.taskId : '记录'}未能保存到本机，请先核对平台任务，勿重新提交：${error.message}`); }
    } catch (error) {
      task.status = task.taskId ? 'processing' : 'uncertain'; task.error = task.taskId ? error.message : '提交状态未确认，请先核对平台任务记录，勿重复提交：' + error.message;
      await this.write(task).catch(() => {});
      if (task.taskId) this.active.add(task.id);
    }
    return this.public(task);
  }
  refresh(id) {
    this.file(id);
    if (this.operations.has(id)) return this.operations.get(id);
    const pending = this.refreshInner(id).finally(() => this.operations.delete(id));
    this.operations.set(id, pending); return pending;
  }
  async refreshInner(id) {
    const task = await this.read(id);
    if (task.status === 'completed' && (await fs.stat(this.file(id, 'glb')).catch(() => null))?.size === task.bytes) return this.public(task);
    if (!task.taskId || task.status === 'failed') return this.public(task);
    if (task.nextPollAt > Date.now()) return this.public(task);
    const channel = this.store.value.channels.find(channel => channel.id === task.channelId);
    if (!channel?.apiKey || channel.protocol !== runningHub.protocol) { task.status = 'blocked'; task.error = '原 3D 渠道或密钥不可用，请恢复原渠道配置后重新查询'; this.active.delete(id); await this.write(task); return this.public(task); }
    this.active.add(id);
    try {
      const result = await runningHub.query({ ...channel, baseUrl: task.baseUrl }, task.taskId, { fetchImpl: this.store.fetchImpl, signal: this.controller.signal });
      const status = String(result.status || '').toUpperCase();
      if (status === 'SUCCESS') {
        const output = result.results?.find(item => /^(?:glb)$/i.test(item.outputType || '') || /\.glb(?:\?|$)/i.test(item.url || ''));
        if (!output?.url) { task.status = 'failed'; this.active.delete(id); throw new Error('3D 任务没有返回可导入的 GLB 文件，请在平台核对输出格式；不会自动重新提交'); }
        task.resultUrl = output.url;
        await this.download(task);
        task.status = 'completed'; task.error = ''; task.completedAt = Date.now(); this.active.delete(id);
      } else if (['FAILED', 'CANCELLED', 'CANCELED', 'CANCEL'].includes(status)) {
        task.status = 'failed'; task.error = result.errorMessage || result.errorCode || '3D 生成失败'; this.active.delete(id);
      } else if (!['QUEUED', 'RUNNING'].includes(status)) throw new Error(result.errorMessage || '平台未返回有效的 3D 任务状态');
      else { task.status = 'processing'; task.error = ''; }
    } catch (error) {
      task.error = error.message;
      if (error.code === 'MODEL_TOO_LARGE') { task.status = 'failed'; this.active.delete(id); }
      else if (task.status !== 'failed' && task.resultUrl) task.status = 'download_failed';
      task.nextPollAt = Date.now() + 30000;
    }
    await this.write(task);
    return this.public(task);
  }
  async download(task) {
    const url = new URL(task.resultUrl);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('3D 模型下载地址无效');
    await writableDirectory(this.store.dataDir); await requireFreeSpace(this.store.dataDir, maxBytes);
    const response = await this.store.fetchImpl(url.href, { credentials: 'omit', signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(120000)]) });
    if (!response.ok || !response.body) throw new Error('GLB 模型下载失败（HTTP ' + response.status + '），稍后将继续查询原任务');
    const temporary = this.file(task.id, crypto.randomUUID() + '.part');
    let size = 0, header = Buffer.alloc(0);
    const inspect = new Transform({ transform(chunk, _encoding, callback) {
      size += chunk.length;
      if (size > maxBytes) return callback(Object.assign(new Error('生成模型超过本机 100 MB 导入上限，请在平台保存原文件或调低模型面数'), { code: 'MODEL_TOO_LARGE' }));
      if (header.length < 12) header = Buffer.concat([header, chunk.subarray(0, 12 - header.length)]);
      callback(null, chunk);
    } });
    try {
      await pipeline(Readable.fromWeb(response.body), inspect, createWriteStream(temporary, { flags: 'wx' }));
      if (header.length !== 12 || header.toString('ascii', 0, 4) !== 'glTF' || header.readUInt32LE(4) !== 2 || header.readUInt32LE(8) !== size) throw new Error('下载结果不是完整的 GLB 2.0 模型，请核对平台结果');
      await fs.rename(temporary, this.file(task.id, 'glb')); task.bytes = size;
    } finally { await fs.rm(temporary, { force: true }); }
  }
  async open(id) { const task = await this.read(id); if (task.status !== 'completed') throw new Error('3D 模型尚未保存完成'); const file = this.file(id, 'glb'); const stat = await fs.lstat(file); if (!stat.isFile() || stat.size !== task.bytes) throw new Error('已保存的 GLB 文件不可用，请重新查询原任务'); return { file, bytes: stat.size }; }
  async export(id) { const { file, bytes } = await this.open(id); if (!this.choose) throw new Error('请通过启动器选择保存目录'); const directory = await this.choose(); return directory ? this.exporter.copy({ source: file, bytes, ext: '.glb' }, directory, '3D模型-' + id.slice(0, 8)) : null; }
  async tick() { if (this.ticking || this.controller.signal.aborted) return; this.ticking = true; try { await this.ready; for (const id of this.active) { if (this.controller.signal.aborted) break; await this.refresh(id).catch(error => this.log('3D 查询：' + error.message)); } } finally { this.ticking = false; } }
  async close() { clearInterval(this.timer); this.controller.abort(); await Promise.allSettled([...this.operations.values()]); }
}
module.exports = { Model3DTasks };
