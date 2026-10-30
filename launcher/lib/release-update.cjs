const fs = require('node:fs/promises');
const { createReadStream, createWriteStream } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const semver = require('semver');
const { stageUpdate } = require('./update.cjs');
const { atomicJson, verifyManifest, writableDirectory } = require('./files.cjs');

async function digest(file) { const hash = crypto.createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex'); }
class ReleaseUpdater extends EventEmitter {
  constructor({ dataDir, currentVersion, source, fetchImpl = fetch }) {
    super(); Object.assign(this, { dataDir, currentVersion, source, fetchImpl });
    this.controller = new AbortController();
    if (!semver.valid(currentVersion) || !/^[\w-]+$/.test(source.owner) || !/^[\w.-]+$/.test(source.repository)) throw new Error('更新源或版本配置无效');
    this.root = path.join(dataDir, 'updates'); this.pendingFile = path.join(this.root, 'pending.json');
    this.releaseUrl = `https://github.com/${source.owner}/${source.repository}/releases`;
    this.state = { phase: 'idle', currentVersion, latestVersion: '', progress: 0, message: '点击检查更新，或导入完整发行包', releaseUrl: this.releaseUrl, notes: '' };
  }
  status() { return { ...this.state }; }
  update(value) { Object.assign(this.state, value); this.emit('status', this.status()); }
  async initialize() {
    try {
      const pending = JSON.parse(await fs.readFile(this.pendingFile, 'utf8'));
      if (!/^[a-f0-9-]{36}$/.test(pending.id) || !semver.valid(pending.version)) throw new Error('待安装更新记录无效');
      if (!semver.gt(pending.version, this.currentVersion)) { await fs.rm(this.pendingFile, { force: true }); return this; }
      const staged = path.join(this.root, pending.id), manifest = await verifyManifest(staged, { filename: 'package-manifest.json' });
      if (manifest.version !== pending.version) throw new Error('待安装更新版本不匹配');
      this.staged = { path: staged, version: pending.version };
      this.update({ phase: 'ready', latestVersion: pending.version, progress: 100, message: `更新 ${pending.version} 已校验，可以重启安装` });
    } catch (error) { if (error.code !== 'ENOENT') this.update({ phase: 'error', message: `上次更新不可用：${error.message}，请重新下载或导入发行包` }); }
    return this;
  }
  async request(url) {
    const response = await this.fetchImpl(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Canvas-Studio-Updater/' + this.currentVersion }, signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(20000)]) });
    if (!response.ok) throw new Error(response.status === 403 ? 'GitHub 更新检查暂时受限，请稍后重试或导入发行包' : `更新服务返回 ${response.status}`);
    return response;
  }
  assetUrl(value) {
    const url = new URL(value);
    if (url.origin !== 'https://github.com' || !url.pathname.startsWith(`/${this.source.owner}/${this.source.repository}/releases/download/`)) throw new Error('更新文件地址不属于本项目发布源');
    return url.href;
  }
  async check() {
    if (this.checkPromise) return this.checkPromise;
    if (this.downloadPromise) return this.status();
    this.checkPromise = this.checkInner().catch(error => { this.update({ phase: this.staged ? 'ready' : 'error', message: `检查更新失败：${error.message}。可稍后重试。` }); throw error; }).finally(() => { this.checkPromise = null; });
    return this.checkPromise;
  }
  async checkInner() {
    this.update({ phase: 'checking', message: '正在检查 GitHub 最新发行版…' });
    const url = `https://api.github.com/repos/${this.source.owner}/${this.source.repository}/releases/latest`;
    let response;
    try { response = await this.request(url); } catch (error) { if (error.message.includes('404')) { this.update({ phase: this.staged ? 'ready' : 'current', message: this.staged ? '已有校验好的更新，可重启安装' : '尚无公开发行版，可继续使用当前版本或导入发行包' }); return this.status(); } throw error; }
    const release = await response.json(), version = semver.valid(String(release.tag_name || '').replace(/^v/, ''));
    if (!version || release.draft || release.prerelease || semver.prerelease(version)) throw new Error('发行版不是有效的正式版本');
    if (!semver.gt(version, this.currentVersion)) { this.update({ phase: this.staged ? 'ready' : 'current', latestVersion: version, message: this.staged ? '已有校验好的更新，可重启安装' : '当前已是最新版本' }); return this.status(); }
    const name = `CanvasStudio-Windows-x64-${version}.zip`;
    const asset = release.assets?.find(entry => entry.name === name), checksum = release.assets?.find(entry => entry.name === name + '.sha256');
    if (!asset || !checksum || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > 2 * 1024 ** 3) throw new Error('发行版缺少 Windows 整合包或 SHA-256 校验文件');
    const downloadUrl = this.assetUrl(asset.browser_download_url), checksumUrl = this.assetUrl(checksum.browser_download_url);
    if (checksum.size > 4096) throw new Error('校验文件大小异常');
    const hashResponse = await this.request(checksumUrl), hashText = await hashResponse.text();
    const match = hashText.trim().match(/^([a-f0-9]{64})[ \t]+\*?(.+)$/i);
    if (!match || match[2] !== name) throw new Error('发行包校验文件格式不正确');
    const expected = match[1].toLowerCase();
    if (asset.digest && asset.digest !== 'sha256:' + expected) throw new Error('GitHub 文件摘要与发行校验值不一致');
    this.candidate = { version, name, size: asset.size, expected, url: downloadUrl };
    this.update({ phase: this.staged?.version === version ? 'ready' : 'available', latestVersion: version, notes: String(release.body || '').slice(0, 20000), progress: this.staged?.version === version ? 100 : 0, message: this.staged?.version === version ? `更新 ${version} 已校验，可以重启安装` : `发现新版本 ${version}，可下载并校验后安装` });
    return this.status();
  }
  async download() {
    if (this.downloadPromise) return this.downloadPromise;
    if (!this.candidate) throw new Error('请先检查更新');
    this.downloadPromise = this.downloadInner().catch(error => { this.update({ phase: 'error', message: `更新下载或校验失败：${error.message}。当前程序和项目仍保留。` }); throw error; }).finally(() => { this.downloadPromise = null; });
    return this.downloadPromise;
  }
  async downloadInner() {
    await writableDirectory(this.dataDir);
    const candidate = this.candidate, directory = path.join(this.root, 'downloads'), file = path.join(directory, candidate.name);
    await fs.mkdir(directory, { recursive: true });
    let cached = false;
    try { cached = (await fs.stat(file)).size === candidate.size && await digest(file) === candidate.expected; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!cached) {
      const partial = file + '.' + crypto.randomUUID() + '.part';
      this.update({ phase: 'downloading', progress: 0, message: '正在下载更新到机械盘…', bytes: 0, total: candidate.size });
      try {
        const response = await this.fetchImpl(candidate.url, { headers: { 'User-Agent': 'Canvas-Studio-Updater/' + this.currentVersion }, signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(30 * 60 * 1000)]) });
        if (!response.ok || !response.body) throw new Error(`下载服务返回 ${response.status}`);
        let bytes = 0, previousPercent = -1; const hash = crypto.createHash('sha256');
        const meter = new Transform({ transform: (chunk, _encoding, callback) => {
          bytes += chunk.length;
          if (bytes > candidate.size) return callback(new Error('下载文件超过发行版声明大小'));
          hash.update(chunk); const progress = Math.floor(bytes / candidate.size * 100);
          if (progress !== previousPercent) { previousPercent = progress; this.update({ progress, bytes }); }
          callback(null, chunk);
        } });
        await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(partial, { flags: 'wx', mode: 0o600 }));
        if (bytes !== candidate.size || hash.digest('hex') !== candidate.expected) throw new Error('下载内容的 SHA-256 或大小不匹配');
        await fs.rename(partial, file);
      } finally { await fs.rm(partial, { force: true }); }
    }
    this.update({ phase: 'verifying', progress: 100, message: '正在解压并校验全部程序文件…' });
    const staged = await stageUpdate(file, this.dataDir);
    try {
      const manifest = await verifyManifest(staged, { filename: 'package-manifest.json' });
      if (manifest.version !== candidate.version) throw new Error('更新包内部版本与发行版不一致');
      await atomicJson(this.pendingFile, { id: path.basename(staged), version: candidate.version });
      this.staged = { path: staged, version: candidate.version };
    } catch (error) { await fs.rm(staged, { recursive: true, force: true }); throw error; }
    this.update({ phase: 'ready', latestVersion: candidate.version, message: `更新 ${candidate.version} 已校验，点击“重启安装更新”应用` }); return this.status();
  }
  async installation() {
    if (!this.staged) throw new Error('请先下载并校验更新');
    await writableDirectory(this.dataDir);
    const manifest = await verifyManifest(this.staged.path, { filename: 'package-manifest.json' });
    if (manifest.version !== this.staged.version || !semver.gt(manifest.version, this.currentVersion)) throw new Error('待安装版本无效');
    return this.staged.path;
  }
  async close() { this.controller.abort(); await Promise.allSettled([this.checkPromise, this.downloadPromise].filter(Boolean)); }
}
module.exports = { ReleaseUpdater };
