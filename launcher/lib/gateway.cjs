const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const proxyFactory = require('http-proxy');
const mime = require('mime-types');
const { Readable } = require('node:stream');
const { pathToFileURL } = require('node:url');
const { CanvasBridge } = require('./canvas-bridge.cjs');
const { directorModelId } = require('./config.cjs');
const { atomicJson, contained, writableDirectory } = require('./files.cjs');

function json(res, status, value) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); }
async function bodyJson(req, limit = 1024 * 1024) {
  let length = 0; const chunks = [];
  for await (const chunk of req) { length += chunk.length; if (length > limit) throw new Error('文件超过允许大小'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function jsonEqual(a, b) { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); }

class Gateway {
  constructor({ store, root, apiPort, webPort, cozyPort, livePort, serviceToken, providerToken, log, chooseFolder }) {
    Object.assign(this, { store, root, apiPort, webPort, cozyPort, livePort, serviceToken, providerToken, log });
    this.bootstrap = crypto.randomBytes(32).toString('hex');
    this.cookie = crypto.randomBytes(32).toString('hex');
    this.proxy = proxyFactory.createProxyServer({ ws: true, proxyTimeout: 0, timeout: 0 });
    this.proxy.on('error', (e, req, res) => { log(`本机连接失败：${e.message}`); if (res.writeHead && !res.headersSent) json(res, 502, { code: 1, msg: '本地服务未就绪，请查看启动器日志' }); else res.destroy(); });
    this.writes = new Map();
    this.sockets = new Set();
    this.bridge = new CanvasBridge();
    this.folders = new (require('./folders.cjs').FolderStore)(store.dataDir, chooseFolder);
  }
  authenticated(req) { return (req.headers.cookie || '').split(';').some(entry => entry.trim() === `canvas_session=${this.cookie}`); }
  validOrigin(req) { return !req.headers.origin || req.headers.origin === this.origin; }
  async listen(port) {
    this.server = http.createServer((req, res) => this.handle(req, res).catch(error => { this.log(error.message); if (!res.headersSent) json(res, 500, { code: 1, msg: error.message }); else res.destroy(); }));
    this.server.on('connection', socket => { this.sockets.add(socket); socket.once('close', () => this.sockets.delete(socket)); });
    this.server.on('upgrade', (req, socket, head) => {
      if (req.headers.host !== this.host || !this.validOrigin(req) || !this.authenticated(req) || req.url !== '/cozy/live') return socket.destroy();
      req.url = '/live'; this.proxy.ws(req, socket, head, { target: `ws://127.0.0.1:${this.livePort}` });
    });
    await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(port, '127.0.0.1', resolve); });
    this.host = `127.0.0.1:${this.server.address().port}`; this.origin = `http://${this.host}`;
    const tokenFile = path.join(this.store.dataDir, 'config', 'mcp-token');
    try { this.mcpToken = await fs.readFile(tokenFile, 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; this.mcpToken = crypto.randomBytes(32).toString('hex'); await fs.mkdir(path.dirname(tokenFile), { recursive: true }); await fs.writeFile(tokenFile, this.mcpToken, { mode: 0o600 }); }
    if (!/^[a-f0-9]{64}$/.test(this.mcpToken)) throw new Error('MCP 本机凭据损坏，请在检查与修复中查看数据目录');
    this.mcpConfigFile = path.join(this.store.dataDir, 'config', 'mcp-connection.json');
    await atomicJson(this.mcpConfigFile, { url: this.origin, token: this.mcpToken });
    await fs.chmod(this.mcpConfigFile, 0o600);
    return this.origin;
  }
  launchUrl() { return `${this.origin}/local/bootstrap#${this.bootstrap}`; }
  skillTools() {
    return [
      { name: 'canvas_studio_skill_list', description: '列出本机用户 Skill 的名称与用途', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
      { name: 'canvas_studio_skill_get', description: '读取指定 Skill 的完整 Markdown 指令', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, annotations: { readOnlyHint: true } },
      { name: 'canvas_studio_skill_save', description: '新建或修改本机用户 Skill，与启动器 Skill 管理共用；Markdown 作为模型指令，不执行脚本', inputSchema: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, content: { type: 'string', maxLength: 20000 } }, required: ['name', 'content'] } },
      { name: 'canvas_studio_skill_delete', description: '删除指定本机用户 Skill', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, annotations: { destructiveHint: true } },
    ];
  }
  async skillCall(name, args, signal) {
    const api = async (route, options = {}) => {
      const response = await fetch(`http://127.0.0.1:${this.apiPort}/api/v1/agent-skills${route}`, { ...options, headers: { 'X-Canvas-Local-Token': this.serviceToken, 'Content-Type': 'application/json' }, signal });
      const value = await response.json(); if (!response.ok || value.code !== 0) throw new Error(value.msg || 'Skill 操作失败'); return value.data;
    };
    if (name === 'canvas_studio_skill_list') return (await api('')).map(({ content, ...skill }) => skill);
    if (name === 'canvas_studio_skill_get') { const skill = (await api('')).find(s => s.id === args.id); if (!skill) throw new Error('Skill 不存在'); return skill; }
    if (name === 'canvas_studio_skill_save') return api('', { method: 'POST', body: JSON.stringify({ id: args.id, name: args.name, description: args.description, content: args.content }) });
    if (name === 'canvas_studio_skill_delete' && typeof args.id === 'string' && args.id) return api('/' + encodeURIComponent(args.id), { method: 'DELETE' });
    throw new Error('未知的 Skill 工具');
  }
  async handle(req, res) {
    if (req.headers.host !== this.host || !this.validOrigin(req) || req.headers['sec-fetch-site'] === 'cross-site') return json(res, 403, { msg: '仅允许本机工作台访问' });
    const url = new URL(req.url, this.origin);
    if (/^\/mcp\/(canvas|director)$/.test(url.pathname)) {
      if (!this.mcpToken || !jsonEqual(req.headers.authorization, `Bearer ${this.mcpToken}`)) return json(res, 401, { msg: '需要本整合包的 MCP 连接凭据' });
      if (url.pathname === '/mcp/director') { req.headers.authorization = `Bearer ${this.providerToken}`; return this.proxy.web(req, res, { target: `http://127.0.0.1:${this.cozyPort}` }); }
      const { studioMcpHttp } = await import(pathToFileURL(path.join(this.root, 'integrations/cozyclay/mcp/studio-http.mjs')));
      return studioMcpHttp(req, res, { name: 'canvas-studio-canvas', version: '1.3.0', tools: () => [...this.bridge.tools(), ...this.skillTools()], call: (name, args, signal) => name.startsWith('canvas_studio_skill_') ? this.skillCall(name, args, signal) : this.bridge.call(name, args, signal) });
    }
    if (url.pathname === '/local/health') return json(res, 200, { application: 'canvas-studio', ready: true });
    if (url.pathname === '/local/bootstrap' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
      return res.end('<!doctype html><meta charset="utf-8"><title>正在打开画布工作台</title><p id="status">正在打开工作台…</p><script>const key=location.hash.slice(1);history.replaceState(null,"","/local/bootstrap");fetch("/local/session",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({key})}).then(r=>{if(!r.ok)throw Error();location.replace("/canvas")}).catch(()=>{document.getElementById("status").textContent="本机会话已失效，请从启动器重新打开工作台。"})</script>');
    }
    if (url.pathname === '/local/session' && req.method === 'POST') {
      const value = await bodyJson(req, 1024);
      if (!jsonEqual(value.key, this.bootstrap)) return json(res, 403, { msg: '本机会话无效' });
      res.setHeader('set-cookie', `canvas_session=${this.cookie}; HttpOnly; SameSite=Strict; Path=/`);
      return json(res, 200, { ok: true });
    }
    const provider = url.pathname.startsWith('/local-ai/');
    const internal = provider && jsonEqual(req.headers.authorization, `Bearer ${this.providerToken}`);
    if (!this.authenticated(req) && !internal) return json(res, 401, { msg: '请从启动器打开工作台' });
    if (provider) return this.provider(req, res, url);
    if (url.pathname === '/local/folders/select' && req.method === 'POST') return json(res, 200, await this.folders.select());
    const folderRoute = url.pathname.match(/^\/local\/folders\/([a-f0-9-]+)(\/import)?$/);
    if (folderRoute) {
      if (folderRoute[2] && req.method === 'POST') return json(res, 200, await this.folders.import(folderRoute[1], await bodyJson(req), this.apiPort, this.serviceToken));
      if (!folderRoute[2] && req.method === 'GET') return json(res, 200, await this.folders.scan(folderRoute[1], url.searchParams.get('recursive') === '1'));
      return json(res, 405, { msg: '不支持的操作' });
    }
    if (url.pathname === '/local/media/video-sheet' && req.method === 'POST') {
      if ((this.videoJobs || 0) >= 2) { req.resume(); return json(res, 429, { msg: '视频处理繁忙，请等待当前附件完成后再添加' }); }
      this.videoJobs = (this.videoJobs || 0) + 1;
      try { return await require('./video-sheet.cjs').videoSheet(req, res, { root: this.root, dataDir: this.store.dataDir }); }
      finally { this.videoJobs -= 1; }
    }
    if (url.pathname === '/local/mcp/config' && req.method === 'GET') {
      const command = path.join(this.root, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node');
      const script = path.join(this.root, 'launcher', 'mcp-stdio.mjs');
      const mcpServers = Object.fromEntries(['canvas', 'director'].map(scope => [`canvas-studio-${scope}`, { command, args: [script, this.mcpConfigFile, scope] }]));
      return json(res, 200, { mcpServers, endpoints: { canvas: this.origin + '/mcp/canvas', director: this.origin + '/mcp/director' }, token: this.mcpToken, canvases: this.bridge.workspaces() });
    }
    if (url.pathname.startsWith('/local/agent/')) return this.bridge.handle(req, res, url.pathname.slice('/local/agent'.length), () => bodyJson(req, 20 * 1024 * 1024));
    if (url.pathname === '/local/config') {
      if (req.method === 'GET') return json(res, 200, this.store.public());
      if (req.method === 'POST') { const result = await this.store.save(await bodyJson(req)); await this.onConfig?.(); return json(res, 200, result); }
      return json(res, 405, { msg: '不支持的操作' });
    }
    if (url.pathname === '/local/channels/test' && req.method === 'POST') return json(res, 200, { models: await this.store.testChannel(await bodyJson(req)) });
    if (url.pathname === '/local/source' && req.method === 'GET') {
      const file = path.resolve(this.root, '..', '..', '对应源码.zip');
      try { const stat = await fs.stat(file); res.writeHead(200, { 'content-type': 'application/zip', 'content-length': stat.size, 'content-disposition': 'attachment; filename="corresponding-source.zip"' }); return require('node:fs').createReadStream(file).pipe(res); }
      catch { return json(res, 404, { msg: '开发模式请使用当前源码目录；发行包源码位于整合包根目录的对应源码.zip' }); }
    }
    if (url.pathname.startsWith('/local/director/')) {
      const id = url.pathname.slice('/local/director/'.length);
      if (!/^[a-zA-Z0-9_-]{1,160}$/.test(id)) return json(res, 400, { msg: '导演台编号无效' });
      const file = path.join(this.store.dataDir, 'projects', 'director', id + '.json');
      if (req.method === 'GET') {
        try { return json(res, 200, JSON.parse(await fs.readFile(file, 'utf8'))); }
        catch (e) { if (e.code === 'ENOENT') return json(res, 404, { msg: '暂无保存的导演台场景' }); throw e; }
      }
      if (req.method === 'PUT') {
        const value = await bodyJson(req, 400 * 1024 * 1024);
        if (value.engine !== 'cozyclay' || value.schemaVersion !== 1 || value.project?.app !== 'cozyclay' || value.project?.kind !== 'project') return json(res, 400, { msg: '导演台项目格式无效' });
        await writableDirectory(this.store.dataDir);
        const previous = this.writes.get(id) || Promise.resolve();
        const write = previous.catch(() => {}).then(() => atomicJson(file, value)); this.writes.set(id, write);
        try { await write; } finally { if (this.writes.get(id) === write) this.writes.delete(id); }
        return json(res, 200, { saved: true });
      }
      return json(res, 405, { msg: '不支持的操作' });
    }
    if (url.pathname === '/admin/settings') { res.writeHead(302, { location: '/local-settings' }); return res.end(); }
    if (/^\/(login|admin\/(users|credit-logs))/.test(url.pathname)) { res.writeHead(302, { location: '/canvas' }); return res.end(); }
    if (/^\/api\/(auth\/(login|register|linux-do)|admin\/(login|users|credit-logs))/.test(url.pathname)) return json(res, 404, { code: 1, msg: '本机版无需账号登录' });
    if (url.pathname.startsWith('/api/')) {
      req.headers['x-canvas-local-token'] = this.serviceToken;
      return this.proxy.web(req, res, { target: `http://127.0.0.1:${this.apiPort}` });
    }
    if (url.pathname.startsWith('/cozy/agent/') || url.pathname.startsWith('/cozy/oauth/')) {
      req.url = req.url.slice('/cozy'.length);
      req.headers.origin = `http://127.0.0.1:${this.cozyPort}`;
      req.headers.host = `127.0.0.1:${this.cozyPort}`;
      return this.proxy.web(req, res, { target: `http://127.0.0.1:${this.cozyPort}`, cookiePathRewrite: { '/agent': '/cozy/agent' } });
    }
    if (url.pathname.startsWith('/cozy/') || /^\/(models|textures|fonts|hdr|kits|poses|motions|thumbs|icons|scenes)\//.test(url.pathname)) {
      return this.staticFile(req, res, url.pathname);
    }
    return this.proxy.web(req, res, { target: `http://127.0.0.1:${this.webPort}` });
  }
  async staticFile(req, res, pathname) {
    const root = path.join(this.root, 'integrations', 'cozyclay', 'dist');
    const relative = decodeURIComponent(pathname.replace(/^\/cozy\//, '').replace(/^\//, ''));
    const file = contained(root, relative.endsWith('/') ? relative + 'index.html' : relative);
    let stat;
    try { stat = await fs.stat(file); if (!stat.isFile()) throw new Error(); } catch { return json(res, 404, { msg: '白模资源不存在' }); }
    if (file.endsWith('.html')) {
      let html = await fs.readFile(file, 'utf8');
      const config = this.store.public();
      const boot = JSON.stringify({ directorModel: config.directorModel ? directorModelId(config.directorChannelId, config.directorModel) : '' }).replace(/</g, '\\u003c');
      html = html.replace('<head>', `<head><script>window.__CANVAS_LOCAL__=${boot};window.__COZYCLAY_LIVE__=true;window.__COZYCLAY_LIVE_URL__='ws://'+location.host+'/cozy/live';try{localStorage.setItem('cozyclay.locale','zh')}catch{}</script>`);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); return res.end(html);
    }
    res.writeHead(200, { 'content-type': mime.lookup(file) || 'application/octet-stream', 'content-length': stat.size, 'cache-control': 'no-cache' });
    require('node:fs').createReadStream(file).pipe(res);
  }
  async provider(req, res, url) {
    const config = this.store.value;
    const director = url.pathname.startsWith('/local-ai/director/');
    const match = url.pathname.match(/^\/local-ai\/channels\/([a-zA-Z0-9_-]+)(?=\/)/);
    if (!director && !match) return json(res, 404, { error: { message: '模型渠道路径无效，请刷新工作台' } });
    const route = url.pathname.slice(director ? '/local-ai/director'.length : match[0].length).replace(/^\/v1(?=\/|$)/, '');
    let channel, buffer;
    if (director) {
      const channels = config.channels.filter(entry => entry.enabled);
      if (req.method === 'GET' && route === '/models') return json(res, 200, { object: 'list', data: channels.flatMap(entry => entry.models.filter(model => entry.modelCapabilities[model] === 'text').map(model => ({ id: directorModelId(entry.id, model), name: `${entry.name} · ${model}`, object: 'model', owned_by: entry.name }))) });
      if (req.method !== 'POST' || !['/chat/completions', '/responses'].includes(route)) return json(res, 404, { error: { message: '导演台模型接口无效' } });
      const body = await bodyJson(req, 64 * 1024 * 1024);
      channel = channels.find(entry => entry.models.some(model => entry.modelCapabilities[model] === 'text' && directorModelId(entry.id, model) === body.model));
      if (!channel) return json(res, 400, { error: { message: '该渠道或模型已停用，请重新选择白模导演模型' } });
      body.model = body.model.slice(channel.id.length + 2);
      const bytes = Buffer.from(JSON.stringify(body)); buffer = Readable.from([bytes]);
      req.headers['content-length'] = String(bytes.length); delete req.headers['transfer-encoding'];
    } else channel = config.channels.find(entry => entry.id === match[1] && entry.enabled);
    if (!channel) return json(res, 400, { error: { message: '该渠道已停用或删除，请重新选择；已提交任务不会转到其他渠道' } });
    if (!channel.baseUrl) return json(res, 503, { error: { message: `请先配置渠道「${channel.name}」的接口地址` } });
    if (req.method === 'GET' && route === '/models') {
      return json(res, 200, { object: 'list', data: channel.models.map(id => ({ id, object: 'model', owned_by: channel.name })) });
    }
    if (!/^\/(chat\/completions|responses|images\/(generations|edits)|videos(?:\/[^/?]+(?:\/content)?)?|audio\/(speech|transcriptions)|models)(?:\?|$)/.test(route)) return json(res, 404, { error: { message: '不支持的模型接口' } });
    req.url = '/v1' + route + url.search;
    delete req.headers.cookie; delete req.headers.origin; delete req.headers.referer;
    if (channel.apiKey) req.headers.authorization = `Bearer ${channel.apiKey}`; else delete req.headers.authorization;
    return this.proxy.web(req, res, { target: channel.baseUrl, changeOrigin: true, secure: true, ...(buffer ? { buffer } : {}) });
  }
  async close() { this.bridge.close(); await Promise.allSettled([...this.writes.values()]); this.proxy.close(); for (const socket of this.sockets) socket.destroy(); this.server?.closeAllConnections(); await new Promise(resolve => this.server ? this.server.close(resolve) : resolve()); }
}

module.exports = { Gateway, bodyJson };
