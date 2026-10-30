const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const { Gateway } = require('./gateway.cjs');
const { writableDirectory, verifyManifest } = require('./files.cjs');
const { openWorkspace, browserExecutable } = require('./browser.cjs');

async function freePort(preferred = 0) {
  const server = net.createServer();
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(preferred, '127.0.0.1', resolve); });
    const port = server.address().port;
    await new Promise(resolve => server.close(resolve)); return port;
  } catch (e) { if (preferred && e.code === 'EADDRINUSE') return freePort(); throw e; }
}
async function ready(url, headers = {}, child) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (child?.launchError) throw child.launchError;
    if (child?.exitCode !== null && child?.exitCode !== undefined) throw new Error('本地服务提前退出，请查看运行日志');
    try { const response = await fetch(url, { headers, signal: AbortSignal.timeout(1500) }); if (response.ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('本地服务启动超时，请查看运行日志');
}

class Runtime extends EventEmitter {
  constructor({ store, root, development = false }) { super(); Object.assign(this, { store, root, development }); this.children = []; this.lines = []; this.state = { phase: 'stopped', progress: 0, message: '准备开始创作', url: '' }; }
  status() { return { ...this.state }; }
  update(next) { Object.assign(this.state, next); this.emit('status', this.status()); }
  log(line) {
    let clean = String(line).replace(/\x1b\[[0-9;]*m/g, '');
    for (const channel of this.store.value.channels) if (channel.apiKey) clean = clean.replaceAll(channel.apiKey, '***');
    clean = clean.replaceAll(this.providerToken || '\0', '***').replaceAll(this.serviceToken || '\0', '***').replace(/Bearer\s+[\w.\-/+=]+/gi, 'Bearer ***').replace(/"(apiKey|access_token|refresh_token|clientSecret|secretAccessKey)"\s*:\s*"[^"]*"/gi, '"$1":"***"');
    for (const text of clean.split(/\r?\n/).filter(Boolean)) this.lines.push(`[${new Date().toLocaleTimeString('zh-CN')}] ${text}`);
    this.lines = this.lines.slice(-600);
    this.emit('log', this.lines.slice(-30));
    if (this.logFile) this.logQueue = (this.logQueue || Promise.resolve()).then(() => fs.appendFile(this.logFile, clean + '\n')).catch(() => {});
  }
  launch(executable, args, env, name) {
    const child = spawn(executable, args, { cwd: this.store.dataDir, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
    this.children.push(child);
    child.stdout.on('data', data => this.log(`${name} ${data}`)); child.stderr.on('data', data => this.log(`${name} ${data}`));
    child.once('error', error => { child.launchError = error; this.log(`${name} ${error.message}`); });
    child.once('exit', code => {
      if (this.state.phase === 'running') { this.update({ phase: 'error', message: `${name}已退出（${code}），请停止后重新启动` }); this.log(this.state.message); }
    });
    return child;
  }
  async check(full = true) {
    await writableDirectory(this.store.dataDir);
    const node = path.join(this.root, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node');
    const api = path.join(this.root, 'runtime', process.platform === 'win32' ? 'canvas-api.exe' : 'canvas-api');
    for (const file of [node, api, path.join(this.root, 'web', 'server.js'), path.join(this.root, 'integrations', 'cozyclay', 'dist', 'app', 'index.html')]) await fs.access(file);
    const result = full ? await verifyManifest(this.root, { required: !this.development }) : { checked: 0 };
    let browser = '';
    try { browser = await browserExecutable(this.store.value); } catch (e) { browser = e.message; }
    return { ...result, browser, dataDir: this.store.dataDir, writable: true };
  }
  async start({ open = true } = {}) {
    if (this.startPromise) return this.startPromise;
    if (this.state.phase === 'running') { if (open) await this.open(); return this.status(); }
    this.startPromise = this.startInner(open).finally(() => { this.startPromise = null; }); return this.startPromise;
  }
  async startInner(open) {
    this.update({ phase: 'starting', progress: 5, message: '检查运行环境' });
    try {
      await this.check(!this.development);
      for (const dir of ['tmp', 'cache', 'logs', 'config', 'projects', 'assets', 'outputs']) await fs.mkdir(path.join(this.store.dataDir, dir), { recursive: true });
      this.logFile = path.join(this.store.dataDir, 'logs', 'launcher.log');
      const publicPort = await freePort(this.store.value.port);
      const apiPort = await freePort(), webPort = await freePort(), cozyPort = await freePort(), livePort = await freePort();
      const serviceToken = crypto.randomBytes(32).toString('hex'), providerToken = crypto.randomBytes(32).toString('hex');
      this.gateway = new Gateway({ store: this.store, root: this.root, apiPort, webPort, cozyPort, livePort, serviceToken, providerToken, log: line => this.log(line) });
      const origin = await this.gateway.listen(publicPort);
      this.gateway.onConfig = () => this.configureCanvas();
      this.apiPort = apiPort; this.serviceToken = serviceToken; this.providerToken = providerToken;
      const env = { ...process.env, TMPDIR: path.join(this.store.dataDir, 'tmp'), TEMP: path.join(this.store.dataDir, 'tmp'), TMP: path.join(this.store.dataDir, 'tmp'), XDG_CACHE_HOME: path.join(this.store.dataDir, 'cache'), XDG_CONFIG_HOME: path.join(this.store.dataDir, 'config'), COZYCLAY_CONFIG_DIR: path.join(this.store.dataDir, 'config', 'cozyclay'), COZYCLAY_LIVE_PORT: String(livePort), COZYCLAY_HTTP_PORT: String(cozyPort), CANVAS_LOCAL_PROVIDER_BASE: origin + '/local-ai/director', CANVAS_LOCAL_PROVIDER_TOKEN: providerToken, COZYCLAY_NO_UPDATE_CHECK: '1', DO_NOT_TRACK: '1', NEXT_TELEMETRY_DISABLED: '1', HOSTNAME: '127.0.0.1', GIN_MODE: 'release' };
      const node = path.join(this.root, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node');
      const api = this.launch(path.join(this.root, 'runtime', process.platform === 'win32' ? 'canvas-api.exe' : 'canvas-api'), [], { ...env, PORT: String(apiPort), CANVAS_LOCAL_TOKEN: serviceToken, CANVAS_LOCAL_DATA_DIR: this.store.dataDir, DATABASE_DSN: path.join(this.store.dataDir, 'workspace.db'), AI_LOG_DIR: path.join(this.store.dataDir, 'logs', 'ai'), ADMIN_USERNAME: '', ADMIN_PASSWORD: '' }, '画布服务');
      this.update({ progress: 25, message: '正在启动画布服务' });
      await ready(`http://127.0.0.1:${apiPort}/api/health`, { 'X-Canvas-Local-Token': serviceToken }, api);
      await this.configureCanvas();
      const web = this.launch(node, [path.join(this.root, 'launcher', 'web-runtime.cjs')], { ...env, PORT: String(webPort), API_BASE_URL: `http://127.0.0.1:${apiPort}`, NODE_ENV: 'production' }, '工作台');
      this.update({ progress: 50, message: '正在启动浏览器工作区' });
      await ready(`http://127.0.0.1:${webPort}/canvas`, {}, web);
      const cozy = this.launch(node, [path.join(this.root, 'launcher', 'cozy-runtime.mjs')], env, '白模导演台');
      this.update({ progress: 75, message: '正在启动白模导演台' });
      await ready(`http://127.0.0.1:${cozyPort}/health`, {}, cozy);
      await ready(`http://127.0.0.1:${cozyPort}/agent/models`, {}, cozy);
      this.update({ phase: 'running', progress: 100, message: '工作台已就绪', url: origin + '/canvas' });
      this.log(`工作台已就绪：${origin}`);
      if (open) await this.open();
      return this.status();
    } catch (error) { await this.stopInner(); this.update({ phase: 'error', progress: 0, message: error.message }); this.log(error.message); throw error; }
  }
  async api(route, options = {}) {
    const response = await fetch(`http://127.0.0.1:${this.apiPort}/api/${route}`, { ...options, headers: { 'X-Canvas-Local-Token': this.serviceToken, 'Content-Type': 'application/json', ...options.headers } });
    const result = await response.json(); if (!response.ok || result.code !== 0) throw new Error(result.msg || '本地配置保存失败'); return result.data;
  }
  async configureCanvas() {
    const config = this.store.value;
    const settings = await this.api('admin/settings');
    settings.private.channels = config.channels.map(channel => ({ ...channel, protocol: 'openai', baseUrl: this.gateway.origin + '/local-ai/channels/' + channel.id, apiKey: this.providerToken, weight: 1, timeout: 600 }));
    settings.public.modelChannel = { ...settings.public.modelChannel, allowCustomChannel: true, allowUserRemoteChannel: true, defaultModel: config.imageModel, defaultImageModel: config.imageModel, defaultTextModel: config.textModel || config.directorModel, defaultVideoModel: config.videoModel, modelCosts: [] };
    settings.public.auth = { allowRegister: false, linuxDo: { enabled: false } };
    settings.private.promptSync = { ...settings.private.promptSync, enabled: false };
    await this.api('admin/settings', { method: 'POST', body: JSON.stringify(settings) });
    const previous = await this.api('v1/user-config');
    await this.api('v1/user-config/model', { method: 'POST', body: JSON.stringify({ config: { ...previous.modelConfig, channelMode: 'remote', imageModel: config.imageModel, imageChannelId: config.imageChannelId, videoModel: config.videoModel, videoChannelId: config.videoChannelId, textModel: config.textModel || config.directorModel, textChannelId: config.textModel ? config.textChannelId : config.directorChannelId, activeChannelId: '', model: config.imageModel } }) });
  }
  async open() { if (!this.gateway || this.state.phase !== 'running') throw new Error('请先启动工作台'); await writableDirectory(this.store.dataDir); await openWorkspace(this.gateway.launchUrl(), this.store.value, this.store.dataDir); }
  async stop() { if (this.startPromise) await this.startPromise.catch(() => {}); await this.stopInner(); this.update({ phase: 'stopped', progress: 0, message: '服务已停止', url: '' }); }
  async stopInner() {
    this.update({ phase: 'stopping', message: '正在停止本地服务' });
    await this.gateway?.close(); this.gateway = null;
    for (const child of this.children.splice(0).reverse()) {
      if (child.exitCode !== null || !child.pid) continue;
      await new Promise(resolve => {
        let timer;
        child.once('exit', () => { clearTimeout(timer); resolve(); });
        if (process.platform === 'win32') { const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }); killer.once('error', resolve); }
        else child.kill('SIGTERM');
        timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 4000);
      });
    }
    await this.logQueue;
  }
}

module.exports = { Runtime, freePort, ready };
