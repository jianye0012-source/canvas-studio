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
function updateNetworkError(error) {
  const detail = [error?.name, error?.message, error?.code, error?.cause?.code, error?.cause?.message].filter(Boolean).join(' ');
  if (/Timeout|TIMED?OUT|CONNECT_TIMEOUT/i.test(detail)) return new Error('连接 GitHub 超时，请检查网络与系统代理，或从发布页下载完整 ZIP 后导入更新');
  if (/CERT_|CERTIFICATE|SELF_SIGNED|certificate/i.test(detail)) return new Error('更新连接的证书验证失败，请检查系统时间、证书与代理设置');
  if (/ENOTFOUND|EAI_AGAIN|NAME_NOT_RESOLVED/i.test(detail)) return new Error('无法解析 GitHub 地址，请检查网络、DNS 或系统代理');
  if (/fetch failed|Failed to fetch|net::ERR_|ECONN|ENETUNREACH|EHOSTUNREACH|socket/i.test(detail)) return new Error('无法连接 GitHub 更新服务，请检查网络与系统代理，或从发布页下载完整 ZIP 后导入更新');
  return error;
}
function releaseVersion(release) { const version = semver.valid(String(release?.tag_name || '').replace(/^v/, '')); return version && !release.draft && !release.prerelease && !semver.prerelease(version) ? version : null; }
class ReleaseUpdater extends EventEmitter {
  constructor({ dataDir, currentVersion, source, fetchImpl = fetch }) {
    super(); Object.assign(this, { dataDir, currentVersion, source, fetchImpl });
    this.controller = new AbortController();
    if (!semver.valid(currentVersion) || !/^[\w-]+$/.test(source.owner) || !/^[\w.-]+$/.test(source.repository)) throw new Error('更新源或版本配置无效');
    this.root = path.join(dataDir, 'updates'); this.pendingFile = path.join(this.root, 'pending.json');
    this.releaseUrl = `https://github.com/${source.owner}/${source.repository}/releases`;
    this.releases = new Map();
    this.state = { phase: 'idle', currentVersion, latestVersion: '', selectedVersion: '', versions: [], progress: 0, message: '点击检查更新，或导入完整发行包', releaseUrl: this.releaseUrl, notes: '' };
  }
  status() { return { ...this.state }; }
  pendingSelection() { return this.staged ? { selectedVersion: this.staged.version, intent: this.staged.intent, notes: String(this.releases.get(this.staged.version)?.body || '').slice(0, 20000) } : {}; }
  update(value) { Object.assign(this.state, value); this.emit('status', this.status()); }
  async initialize() {
    try {
      const pending = JSON.parse(await fs.readFile(this.pendingFile, 'utf8'));
      if (!/^[a-f0-9-]{36}$/.test(pending.id) || !semver.valid(pending.version)) throw new Error('待安装更新记录无效');
      const intent = this.intent(pending.version);
      if ((pending.intent || 'upgrade') !== intent) { await fs.rm(this.pendingFile, { force: true }); return this; }
      const staged = path.join(this.root, pending.id), manifest = await verifyManifest(staged, { filename: 'package-manifest.json' });
      if (manifest.version !== pending.version) throw new Error('待安装更新版本不匹配');
      this.staged = { path: staged, version: pending.version, intent };
      this.update({ phase: 'ready', selectedVersion: pending.version, intent, progress: 100, message: `版本 ${pending.version} 已校验，可以重启安装` });
    } catch (error) { if (error.code !== 'ENOENT') this.update({ phase: 'error', message: `上次更新不可用：${error.message}，请重新下载或导入发行包` }); }
    return this;
  }
  async request(url) {
    let response;
    try { response = await this.fetchImpl(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Canvas-Studio-Updater/' + this.currentVersion }, credentials: 'omit', cache: 'no-store', signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(20000)]) }); }
    catch (error) { throw updateNetworkError(error); }
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
    if (this.downloadPromise || this.selectPromise) return this.status();
    this.checkPromise = this.checkInner().catch(error => { this.update({ ...this.pendingSelection(), phase: this.staged ? 'ready' : 'error', message: `检查更新失败：${error.message}。${this.staged ? `已校验的 ${this.staged.version} 仍可安装。` : '可稍后重试。'}` }); throw error; }).finally(() => { this.checkPromise = null; });
    return this.checkPromise;
  }
  async checkInner() {
    this.update({ phase: 'checking', message: '正在读取 GitHub 正式版本列表…' });
    const releases = new Map();
    for (let page = 1; ; page++) {
      let response;
      try { response = await this.request(`https://api.github.com/repos/${this.source.owner}/${this.source.repository}/releases?per_page=100&page=${page}`); }
      catch (error) { if (error.message.includes('404')) break; throw error; }
      const entries = await response.json().catch(() => { throw new Error('更新服务未返回有效的版本列表，请检查网络或系统代理'); }); if (!Array.isArray(entries)) throw new Error('发行版本列表格式不正确');
      for (const release of entries) { const version = releaseVersion(release); if (version) releases.set(version, release); }
      if (entries.length < 100) break;
    }
    this.releases = releases;
    const versions = [...releases.keys()].sort(semver.rcompare).map(version => ({ version, publishedAt: releases.get(version).published_at || '', notes: String(releases.get(version).body || '').slice(0, 20000), intent: this.intent(version), installable: this.hasAssets(releases.get(version), version) }));
    const version = versions[0]?.version || '';
    this.update({ versions, latestVersion: version });
    if (!version) { this.update({ phase: this.staged ? 'ready' : 'current', message: this.staged ? '已有校验好的更新，可重启安装' : '尚无公开正式版本，可继续使用当前版本或导入发行包' }); return this.status(); }
    if (this.staged && releases.has(this.staged.version)) return this.prepareVersion(this.staged.version);
    if (this.staged) { this.update({ phase: 'ready', selectedVersion: this.staged.version, intent: this.staged.intent, message: `版本 ${this.staged.version} 已校验，可以重启安装；也可选择其他正式版本` }); return this.status(); }
    if (!semver.gt(version, this.currentVersion)) { this.update({ phase: 'current', message: '当前已是最新版本；可在版本列表选择重装或回退' }); return this.status(); }
    return this.prepareVersion(version);
  }
  intent(version) { return semver.gt(version, this.currentVersion) ? 'upgrade' : semver.lt(version, this.currentVersion) ? 'rollback' : 'repair'; }
  hasAssets(release, version) { const name = `CanvasStudio-Windows-x64-${version}.zip`; return Boolean(release.assets?.some(e => e.name === name) && release.assets?.some(e => e.name === name + '.sha256')); }
  async selectVersion(version) {
    if (this.downloadPromise || this.checkPromise || this.selectPromise) throw new Error('请等待当前更新操作完成');
    this.selectPromise = this.prepareVersion(version).catch(error => { this.update({ ...this.pendingSelection(), phase: this.staged ? 'ready' : 'error', message: `选择版本失败：${error.message}` }); throw error; }).finally(() => { this.selectPromise = null; }); return this.selectPromise;
  }
  async prepareVersion(version) {
    const release = this.releases.get(version); if (!release || !semver.valid(version)) throw new Error('请先读取版本列表，再选择一个正式版本');
    this.update({ phase: 'checking', message: `正在核对版本 ${version} 的发行文件…` });
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
    const intent = this.intent(version);
    this.candidate = { version, name, size: asset.size, expected, url: downloadUrl, intent };
    this.update({ phase: this.staged?.version === version ? 'ready' : 'available', selectedVersion: version, intent, notes: String(release.body || '').slice(0, 20000), progress: this.staged?.version === version ? 100 : 0, message: this.staged?.version === version ? `版本 ${version} 已校验，可以重启安装` : intent === 'upgrade' ? `发现新版本 ${version}，可下载并校验后安装` : `已选择${intent === 'rollback' ? '回退' : '重装'}版本 ${version}，下载校验后可安装` });
    return this.status();
  }
  async download() {
    if (this.checkPromise || this.selectPromise) throw new Error('请等待版本核对完成');
    if (this.downloadPromise) return this.downloadPromise;
    if (!this.candidate) throw new Error('请先检查更新');
    this.downloadPromise = this.downloadInner().catch(cause => { const error = updateNetworkError(cause); this.update({ ...this.pendingSelection(), phase: this.staged ? 'ready' : 'error', message: `更新下载或校验失败：${error.message}。当前程序和项目仍保留。${this.staged ? `已校验的 ${this.staged.version} 仍可安装。` : ''}` }); throw error; }).finally(() => { this.downloadPromise = null; });
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
        let response;
        try { response = await this.fetchImpl(candidate.url, { headers: { 'User-Agent': 'Canvas-Studio-Updater/' + this.currentVersion }, credentials: 'omit', cache: 'no-store', signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(30 * 60 * 1000)]) }); }
        catch (error) { throw updateNetworkError(error); }
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
      await atomicJson(this.pendingFile, { id: path.basename(staged), version: candidate.version, intent: candidate.intent });
      const previous = this.staged;
      this.staged = { path: staged, version: candidate.version, intent: candidate.intent };
      if (previous && previous.path !== staged) await fs.rm(previous.path, { recursive: true, force: true }).catch(() => {});
    } catch (error) { await fs.rm(staged, { recursive: true, force: true }); throw error; }
    this.update({ phase: 'ready', latestVersion: candidate.version, message: `更新 ${candidate.version} 已校验，点击“重启安装更新”应用` }); return this.status();
  }
  async installation() {
    if (!this.staged) throw new Error('请先下载并校验更新');
    await writableDirectory(this.dataDir);
    const manifest = await verifyManifest(this.staged.path, { filename: 'package-manifest.json' });
    if (manifest.version !== this.staged.version || this.intent(manifest.version) !== this.staged.intent) throw new Error('待安装版本无效');
    return this.staged.path;
  }
  async close() { this.controller.abort(); await Promise.allSettled([this.checkPromise, this.selectPromise, this.downloadPromise].filter(Boolean)); }
}
module.exports = { ReleaseUpdater, updateNetworkError };
