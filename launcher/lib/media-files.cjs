const fs = require('node:fs/promises');
const { constants, createReadStream } = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const mime = require('mime-types');
const { atomicJson, contained, writableDirectory, requireFreeSpace } = require('./files.cjs');

const mediaType = /^(?:image|video|audio)\//;
const mediaKinds = ['image', 'video', 'audio', 'director', 'media'];
const objectId = /^[a-f0-9-]{36}$/i;

function allowedMedia(kind, type) {
  if (kind === 'director') return /^video\//.test(type) || /^image\/(png|jpeg|webp)$/.test(type);
  return mediaType.test(type) && (kind === 'media' || type.startsWith(kind + '/'));
}

async function matchesExport(file, asset) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.size !== asset.bytes || !asset.sha256) return false;
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex') === asset.sha256;
}

class NativeMediaPicker {
  constructor(choose) { this.choose = choose; this.files = new Map(); }
  async select(kind, multiple) {
    if (!mediaKinds.includes(kind)) throw new Error('文件类型无效');
    if (!this.choose) throw new Error('请从画布工作台启动器打开本机文件窗口');
    const selected = await this.choose(kind, multiple === true);
    const now = Date.now();
    for (const [id, item] of this.files) if (item.expires < now) this.files.delete(id);
    const paths = selected || [];
    const limit = kind === 'director' ? 4 : multiple === true ? 32 : 1;
    if (paths.length > limit) throw new Error(`一次最多选择 ${limit} 个文件`);
    const items = await Promise.all(paths.map(async file => {
      const real = await fs.realpath(file);
      const stat = await fs.stat(real);
      const type = mime.lookup(file) || '';
      if (!stat.isFile() || !stat.size || stat.size > 1024 ** 3 || !allowedMedia(kind, type)) {
        throw new Error(`文件「${path.basename(file)}」格式不受支持、为空或超过 1 GB`);
      }
      return { id: randomUUID(), name: path.basename(file), type, real, size: stat.size, mtime: stat.mtimeMs, expires: now + 5 * 60 * 1000 };
    }));
    if (items.reduce((total, item) => total + item.size, 0) > 1024 ** 3) throw new Error('选择的文件合计超过 1 GB，请分批导入');
    for (const item of items) this.files.set(item.id, item);
    return items.map(({ id, name, type }) => ({ id, name, type }));
  }
  async open(id) {
    const item = this.files.get(id);
    this.files.delete(id);
    if (!item || item.expires < Date.now()) throw new Error('文件选择已过期，请重新选择');
    if (await fs.realpath(item.real) !== item.real) throw new Error('文件位置已改变，请重新选择');
    const handle = await fs.open(item.real, 'r');
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size !== item.size || stat.mtimeMs !== item.mtime) throw new Error('文件已改变，请重新选择');
      return { type: item.type, size: item.size, stream: handle.createReadStream() };
    } catch (error) { await handle.close(); throw error; }
  }
}

class MediaExports {
  constructor(dataDir, { apiPort, token, choose } = {}) {
    Object.assign(this, { dataDir, apiPort, token, choose });
    this.file = path.join(dataDir, 'config', 'media-exports.json');
    this.active = new Map();
  }
  async settings() {
    try { return JSON.parse(await fs.readFile(this.file, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; return { directory: '', enabled: false, enabledAt: 0 }; }
  }
  async configure({ directory, enabled }) {
    const previous = await this.settings();
    const next = { ...previous, directory: directory === undefined ? previous.directory : await fs.realpath(directory), enabled: enabled ?? previous.enabled };
    if (next.enabled && !next.directory) throw new Error('请先选择自动保存的输出目录');
    if (directory !== undefined || next.enabled) await this.checkDirectory(next.directory);
    if (next.enabled && !previous.enabled) next.enabledAt = Date.now();
    await writableDirectory(this.dataDir);
    await atomicJson(this.file, next);
    return next;
  }
  async checkDirectory(directory) {
    try {
      if (path.relative(directory, await fs.realpath(directory))) throw new Error('输出目录已改变');
      await writableDirectory(directory);
    } catch { throw new Error('输出目录不可用，请恢复目标盘或重新选择目录'); }
  }
  async object(id) {
    if (typeof id !== 'string' || !objectId.test(id)) throw new Error('素材编号无效');
    const response = await fetch(`http://127.0.0.1:${this.apiPort}/api/files/${id}`, { headers: { 'X-Canvas-Local-Token': this.token }, signal: AbortSignal.timeout(10000) });
    const { code, data } = await response.json();
    if (!response.ok || code !== 0 || data?.id !== id || data.providerId !== 'local-disk' || !mediaType.test(data.mimeType)) {
      throw new Error('素材未保存在本机或原文件已失效');
    }
    if (path.basename(data.objectKey) !== data.objectKey || !data.objectKey.startsWith(id)) throw new Error('素材路径无效');
    const source = contained(path.join(this.dataDir, 'assets'), data.objectKey);
    if (path.relative(source, await fs.realpath(source)) || !(await fs.stat(source)).isFile()) throw new Error('素材位置已改变');
    const ext = path.extname(data.objectKey);
    return { source, bytes: data.bytes, sha256: data.sha256, ext: /^[.][a-z0-9]{1,11}$/i.test(ext) ? ext : '.' + (mime.extension(data.mimeType) || 'bin') };
  }
  async manual(id, name) {
    if (!this.choose) throw new Error('请从启动器打开工作台后另存素材');
    const asset = await this.object(id);
    const selected = await this.choose();
    if (!selected) return null;
    const directory = await fs.realpath(selected);
    const safe = String(name || '').replace(/[<>:"/\\|?*\p{Cc}]/gu, '_').slice(0, 100).replace(/[. ]+$/, '').replace(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i, '_$&');
    const stem = safe.toLowerCase().endsWith(asset.ext.toLowerCase()) ? safe.slice(0, -asset.ext.length) : safe;
    return this.copy(asset, directory, stem || '素材');
  }
  async automatic(id, completedAt, resultKey = id) {
    const settings = await this.settings();
    if (!settings.enabled || !Number.isSafeInteger(completedAt) || completedAt < settings.enabledAt) return null;
    if (typeof id !== 'string' || !objectId.test(id)) throw new Error('素材编号无效');
    if (typeof resultKey !== 'string' || !resultKey || resultKey.length > 300) throw new Error('生成结果编号无效');
    const receiptId = resultKey === id ? id : createHash('sha256').update(resultKey).digest('hex');
    if (this.active.has(receiptId)) return this.active.get(receiptId);
    const task = (async () => {
      const receipt = path.join(this.dataDir, 'config', 'exported-media', receiptId + '.json');
      try { await fs.access(receipt); return null; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      await writableDirectory(this.dataDir);
      const asset = await this.object(id);
      await this.checkDirectory(settings.directory);
      const result = await this.copy(asset, settings.directory, '生成-' + receiptId, true);
      await atomicJson(receipt, result);
      return result;
    })();
    this.active.set(receiptId, task);
    try { return await task; }
    finally { this.active.delete(receiptId); }
  }
  async copy(asset, directory, stem, stable = false) {
    await this.checkDirectory(directory);
    await requireFreeSpace(directory, asset.bytes);
    const temp = path.join(directory, '.canvas-export-' + randomUUID() + '.tmp');
    try {
      await fs.copyFile(asset.source, temp, constants.COPYFILE_EXCL);
      for (let suffix = 0; ; suffix++) {
        const name = stem + (suffix ? ` (${suffix + 1})` : '') + asset.ext;
        const target = path.join(directory, name);
        try {
          try { await fs.link(temp, target); }
          catch (error) {
            if (!['ENOTSUP', 'EOPNOTSUPP', 'EPERM', 'ENOSYS'].includes(error.code)) throw error;
            await fs.copyFile(temp, target, constants.COPYFILE_EXCL);
          }
          return { name };
        } catch (error) {
          if (error.code !== 'EEXIST') throw error;
          if (stable && await matchesExport(target, asset)) return { name };
        }
      }
    } finally { await fs.rm(temp, { force: true }).catch(() => {}); }
  }
}
module.exports = { NativeMediaPicker, MediaExports };
