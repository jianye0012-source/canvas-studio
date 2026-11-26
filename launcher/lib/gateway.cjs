const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const proxyFactory = require('http-proxy');
const mime = require('mime-types');
const runningHub = require('./runninghub-standard.cjs');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { once } = require('node:events');
const { pathToFileURL } = require('node:url');
const { ProjectEditors, editorIdPattern } = require('./project-editor.cjs');
const { CanvasBridge } = require('./canvas-bridge.cjs');
const { directorModelId, supportsRole } = require('./config.cjs');
const { atomicJson, contained, writableDirectory } = require('./files.cjs');
const { MediaExports, NativeMediaPicker } = require('./media-files.cjs');
const { Model3DTasks } = require('./model-3d-tasks.cjs');
const { DirectorStore } = require('./director-store.cjs');

function json(res, status, value) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); }
async function bodyJson(req, limit = 1024 * 1024) {
  let length = 0; const chunks = [];
  for await (const chunk of req) { length += chunk.length; if (length > limit) throw new Error('文件超过允许大小'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function jsonEqual(a, b) { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); }
const hopHeaders = new Set(['host', 'connection', 'keep-alive', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
const reservedRequestHeaders = new Set([...hopHeaders, 'accept-charset', 'accept-encoding', 'content-length', 'cookie', 'cookie2', 'date', 'dnt', 'expect', 'origin', 'permissions-policy', 'referer', 'set-cookie', 'via', 'authorization']);
async function proxyBody(req, limit = 200 * 1024 * 1024) {
  let length = 0; const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > limit) throw new Error('请求内容超过 200 MB');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, length);
}
async function bodyBytes(req, limit) {
  if (Number(req.headers['content-length']) > limit) throw Object.assign(new Error('素材超过 100 MB'), { status: 413 });
  let length = 0; const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > limit) throw Object.assign(new Error('素材超过 100 MB'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, length);
}

class Gateway {
  constructor({ store, root, apiPort, webPort, cozyPort, livePort, serviceToken, providerToken, log, chooseFolder, chooseMedia, chooseOutput, cancelPicker }) {
    Object.assign(this, { store, root, apiPort, webPort, cozyPort, livePort, serviceToken, providerToken, log, cancelPicker });
    this.bootstrap = crypto.randomBytes(32).toString('hex');
    this.cookie = crypto.randomBytes(32).toString('hex');
    this.proxy = proxyFactory.createProxyServer({ ws: true, proxyTimeout: 0, timeout: 0 });
    this.proxy.on('error', (e, req, res) => {
      const message = '本地服务未就绪，请查看启动器日志';
      log(`${message}：${e.message}`);
      if (res.writeHead && !res.headersSent) json(res, 502, { code: 1, msg: message }); else res.destroy();
    });
    this.writes = new Map();
    this.directors = new DirectorStore(path.join(this.store.dataDir, 'projects'));
    this.sockets = new Set();
    this.bridge = new CanvasBridge();
    this.editors = new ProjectEditors(store.dataDir);
    this.folders = new (require('./folders.cjs').FolderStore)(store.dataDir, chooseFolder);
    this.media = new NativeMediaPicker(chooseMedia);
    this.exports = new MediaExports(store.dataDir, { apiPort, token: serviceToken, choose: chooseOutput });
    this.model3D = new Model3DTasks(store, { exporter: this.exports, choose: chooseOutput, log });
  }
  async serial(id, task) {
    const previous = this.writes.get(id) || Promise.resolve();
    const write = previous.catch(() => {}).then(task); this.writes.set(id, write);
    try { return await write; } finally { if (this.writes.get(id) === write) this.writes.delete(id); }
  }
  mcpServers() {
    const command = path.join(this.root, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node');
    const script = path.join(this.root, 'launcher', 'mcp-stdio.mjs');
    return { 'canvas-studio-canvas': { command, args: [script, this.mcpConfigFile, 'canvas'] } };
  }
  async testMcp(scope) {
    const config = this.mcpServers()[`canvas-studio-${scope}`];
    if (!config || scope !== 'canvas') throw new Error('MCP 类型无效');
    const sdk = name => import(pathToFileURL(path.join(this.root, 'integrations/cozyclay/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client', name)));
    const [{ Client }, { StdioClientTransport }] = await Promise.all([sdk('index.js'), sdk('stdio.js')]);
    const client = new Client({ name: 'canvas-studio-connection-check', version: '1' });
    const transport = new StdioClientTransport({ ...config, stderr: 'ignore' });
    const options = { timeout: 5000 };
    try {
      await client.connect(transport, options);
      const { tools } = await client.listTools({}, options);
      const result = await client.callTool({ name: 'canvas_studio_list_canvases', arguments: {} }, undefined, options);
      if (result.isError) throw new Error(result.content?.[0]?.text || '无法列出工作区');
      const workspaces = JSON.parse(result.content?.[0]?.text || 'null');
      if (!Array.isArray(workspaces) || !tools.length) throw new Error('MCP 返回了无效的工具或工作区列表');
      return { tools: tools.length, workspaces: workspaces.length };
    } finally { await transport.close(); }
  }
  authenticated(req) { return (req.headers.cookie || '').split(';').some(entry => entry.trim() === `canvas_session=${this.cookie}`); }
  async streamMedia(res, { type, size, stream }) {
    res.writeHead(200, { 'content-type': type, 'content-length': size, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': 'sandbox' });
    await pipeline(stream, res);
  }
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
    if (url.pathname === '/mcp/canvas') {
      if (!this.mcpToken || !jsonEqual(req.headers.authorization, `Bearer ${this.mcpToken}`)) return json(res, 401, { msg: '需要本整合包的 MCP 连接凭据' });
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
    if (url.pathname === '/local/3d/models' && req.method === 'GET') return json(res, 200, { models: this.model3D.models() });
    if (url.pathname === '/local/3d/tasks') {
      try {
        if (req.method === 'GET') return json(res, 200, { tasks: await this.model3D.list(url.searchParams.get('sceneId')) });
        if (req.method === 'POST') return json(res, 200, await this.model3D.create(await bodyJson(req, 128 * 1024 ** 2)));
      } catch (error) { if ([400, 404].includes(error.status)) return json(res, error.status, { msg: error.message }); throw error; }
    }
    const model3DRoute = url.pathname.match(/^\/local\/3d\/tasks\/([a-f0-9-]{36})(?:\/(file|export))?$/);
    if (model3DRoute) {
      const [, id, action] = model3DRoute;
      try {
        if (action === 'export' && req.method === 'POST') return json(res, 200, await this.model3D.export(id));
        if (action === 'file' && req.method === 'GET') {
          const { file, bytes } = await this.model3D.open(id);
          res.writeHead(200, { 'Content-Type': 'model/gltf-binary', 'Content-Length': bytes, 'Cache-Control': 'no-store' });
          try { await pipeline(require('node:fs').createReadStream(file), res); } catch (error) { if (!res.destroyed) throw error; }
          return;
        }
        if (!action && req.method === 'GET') return json(res, 200, await this.model3D.refresh(id, { manual: true }));
      } catch (error) { if ([400, 404].includes(error.status)) return json(res, error.status, { msg: error.message }); throw error; }
    }
    const editorRoute = url.pathname.match(/^\/local\/editor\/([a-zA-Z0-9_-]{1,160})(?:\/(step|progress))?$/);
    if (editorRoute) {
      const [, id, operation] = editorRoute;
      const owner = req.method === 'GET' ? url.searchParams.get('id') : req.headers['x-canvas-editor'];
      if (typeof owner !== 'string' || !editorIdPattern.test(owner)) return json(res, 400, { msg: '画布会话编号无效' });
      if (!operation && req.method === 'GET') return this.editors.connect(id, owner, res);
      if (req.method !== 'POST' || !this.editors.canWrite(id, owner)) return json(res, 409, { msg: '画布编辑权限已失效' });
      const value = await bodyJson(req, 4096);
      if (operation === 'step') {
        try { await this.editors.claim(id, owner, value.nodeId, value.attempt); }
        catch (error) { return json(res, 409, { msg: error.message }); }
      } else if (operation === 'progress') this.editors.report(id, value);
      else return json(res, 405, { msg: '不支持的操作' });
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/local/picker/cancel' && req.method === 'POST') { await this.cancelPicker?.(); return json(res, 200, { canceled: true }); }
    if (url.pathname === '/local/folders/select' && req.method === 'POST') return json(res, 200, await this.folders.select());
    const folderRoute = url.pathname.match(/^\/local\/folders\/([a-f0-9-]+)(\/(?:import|preview))?$/);
    if (folderRoute) {
      if (folderRoute[2] === '/preview' && req.method === 'GET') {
        const preview = await this.folders.preview(folderRoute[1], { id: url.searchParams.get('file'), size: Number(url.searchParams.get('size')), mtime: Number(url.searchParams.get('mtime')) });
        return this.streamMedia(res, preview);
      }
      if (folderRoute[2] === '/import' && req.method === 'POST') {
        const item = await bodyJson(req);
        if (req.headers.accept !== 'application/x-ndjson') return json(res, 200, await this.folders.import(folderRoute[1], item, this.apiPort, this.serviceToken));
        const abort = new AbortController();
        res.once('close', () => abort.abort());
        res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' });
        const send = value => { if (!res.destroyed) res.write(JSON.stringify(value) + '\n'); };
        try { send({ result: await this.folders.import(folderRoute[1], item, this.apiPort, this.serviceToken, { signal: abort.signal, onProgress: progress => send({ progress }) }) }); }
        catch (error) { send({ error: error.message }); }
        return res.end();
      }
      if (!folderRoute[2] && req.method === 'GET') return json(res, 200, await this.folders.scan(folderRoute[1], url.searchParams.get('recursive') === '1'));
      return json(res, 405, { msg: '不支持的操作' });
    }
    if (url.pathname === '/local/media/select' && req.method === 'POST') {
      const { kind, multiple } = await bodyJson(req, 1024);
      return json(res, 200, await this.media.select(kind, multiple));
    }
    const pickedMedia = url.pathname.match(/^\/local\/media\/picked\/([a-f0-9-]{36})$/);
    if (pickedMedia && req.method === 'GET') return this.streamMedia(res, await this.media.open(pickedMedia[1]));
    if (url.pathname === '/local/media/export' && req.method === 'POST') {
      const { id, name, completedAt, resultKey } = await bodyJson(req, 2048);
      return json(res, 200, completedAt === undefined ? await this.exports.manual(id, name) : await this.exports.automatic(id, completedAt, resultKey));
    }
    if (url.pathname === '/local/media/video-sheet' && req.method === 'POST') {
      if ((this.videoJobs || 0) >= 2) { req.resume(); return json(res, 429, { msg: '视频处理繁忙，请等待当前附件完成后再添加' }); }
      this.videoJobs = (this.videoJobs || 0) + 1;
      try { return await require('./video-sheet.cjs').videoSheet(req, res, { root: this.root, dataDir: this.store.dataDir }); }
      finally { this.videoJobs -= 1; }
    }
    if (url.pathname === '/local/mcp/config' && req.method === 'GET') {
      const mcpServers = this.mcpServers();
      const instructions = Object.fromEntries(Object.entries(mcpServers).map(([name, config]) => {
        return [name, `请用当前 AI 客户端支持的官方方式安装以下 Canvas Studio 本机 MCP（stdio），只合并所列条目，保留已有连接器。沿用配置中的完整路径和参数。如需信任或重开客户端，请提示我完成。接通后实际调用只读工具 canvas_studio_list_canvases，告诉我返回的工作区。若列表为空，提示我打开对应的画布。若工具未加载，请区分等待信任、配置未生效和服务无法启动。\n\n${JSON.stringify({ mcpServers: { [name]: config } }, null, 2)}`];
      }));
      return json(res, 200, { mcpServers, instructions, endpoints: { canvas: this.origin + '/mcp/canvas' }, token: this.mcpToken, canvases: this.bridge.workspaces() });
    }
    if (url.pathname === '/local/mcp/test' && req.method === 'POST') return json(res, 200, await this.testMcp((await bodyJson(req, 1024)).scope));
    if (url.pathname.startsWith('/local/agent/')) return this.bridge.handle(req, res, url.pathname.slice('/local/agent'.length), () => bodyJson(req, 20 * 1024 * 1024));
    if (url.pathname === '/local/config') {
      if (req.method === 'GET') return json(res, 200, this.store.public());
      if (req.method === 'POST') { const result = await this.store.save(await bodyJson(req)); await this.onConfig?.(); return json(res, 200, result); }
      return json(res, 405, { msg: '不支持的操作' });
    }
    if (url.pathname === '/local/channels/test' && req.method === 'POST') return json(res, 200, await this.store.testChannel(await bodyJson(req)));
    if (url.pathname === '/local/channels/runninghub-model' && req.method === 'POST') {
      const { id, baseUrl } = await bodyJson(req);
      return json(res, 200, await this.store.readRunningHubModel(id, baseUrl));
    }
    if (url.pathname === '/local/source' && req.method === 'GET') {
      const { owner, repository } = require('../update-source.json');
      const { version } = require('../package.json');
      res.writeHead(302, { location: `https://github.com/${owner}/${repository}/releases/tag/v${version}` });
      return res.end();
    }
    if (url.pathname.startsWith('/local/director-assets/')) {
      try {
        const id = this.directors.assetId(url.pathname.slice('/local/director-assets/'.length));
        if (req.method === 'PUT') {
          const bytes = await bodyBytes(req, 100 * 1024 * 1024);
          await writableDirectory(this.store.dataDir);
          return json(res, 200, await this.directors.putAsset(id, bytes, { type: req.headers['x-asset-type'], name: decodeURIComponent(req.headers['x-asset-name']) }));
        }
        if (req.method === 'HEAD' || req.method === 'GET') {
          const asset = await this.directors.assetFile(id);
          if (req.method === 'HEAD') {
            res.writeHead(asset ? 200 : 404, asset ? { 'content-length': asset.meta.size } : {});
            return res.end();
          }
          if (!asset) return json(res, 404, { msg: '素材不存在' });
          res.writeHead(200, { 'content-type': asset.meta.type, 'content-length': asset.meta.size, 'cache-control': 'no-store' });
          await pipeline(require('node:fs').createReadStream(asset.file), res);
          return;
        }
        return json(res, 405, { msg: '不支持的操作' });
      } catch (error) {
        if (req.method === 'HEAD' && error.status === 400) { res.writeHead(400); return res.end(); }
        if ([400, 404, 409, 413].includes(error.status)) return json(res, error.status, { msg: error.message, ...(error.missing ? { missing: error.missing } : {}) });
        throw error;
      }
    }
    if (url.pathname.startsWith('/local/director/')) {
      try {
        const id = url.pathname.slice('/local/director/'.length);
        if (!/^[a-zA-Z0-9_-]{1,160}$/.test(id)) return json(res, 400, { msg: '导演台编号无效' });
        if (req.method === 'GET') {
          const value = await this.serial(id, () => this.directors.readProject(id, { inline: url.searchParams.get('inline') === '1' }));
          return value === null ? json(res, 404, { msg: '暂无保存的导演台场景' }) : json(res, 200, value);
        }
        if (req.method === 'PUT') {
          const value = await bodyJson(req, 400 * 1024 * 1024);
          if (value.engine !== 'cozyclay' || ![1, 2].includes(value.schemaVersion) || value.project?.app !== 'cozyclay' || value.project?.kind !== 'project') return json(res, 400, { msg: '导演台项目格式无效' });
          await writableDirectory(this.store.dataDir);
          await this.serial(id, () => this.directors.writeProject(id, value));
          return json(res, 200, { saved: true });
        }
        if (req.method === 'DELETE') {
          await writableDirectory(this.store.dataDir);
          await this.serial(id, () => this.directors.deleteProject(id));
          return json(res, 200, { deleted: true });
        }
        return json(res, 405, { msg: '不支持的操作' });
      } catch (error) {
        if ([400, 404, 409, 413].includes(error.status)) return json(res, error.status, { msg: error.message, ...(error.missing ? { missing: error.missing } : {}) });
        throw error;
      }
    }
    if (url.pathname === '/admin/settings') { res.writeHead(302, { location: '/local-settings' }); return res.end(); }
    if (/^\/(login|admin\/(users|credit-logs))/.test(url.pathname)) { res.writeHead(302, { location: '/canvas' }); return res.end(); }
    if (/^\/api\/(auth\/(login|register|linux-do)|admin\/(login|users|credit-logs))/.test(url.pathname)) return json(res, 404, { code: 1, msg: '本机版无需账号登录' });
    if (url.pathname.startsWith('/api/')) {
      req.headers['x-canvas-local-token'] = this.serviceToken;
      const projects = '/api/v1/canvas/projects';
      if (req.method === 'POST' && [projects, projects + '/delete', projects + '/sync'].includes(url.pathname)) {
        const payload = await bodyJson(req, 400 * 1024 * 1024);
        const ids = url.pathname.endsWith('/delete') ? payload.ids : url.pathname.endsWith('/sync') ? payload.projects?.map(p => p.id) : [payload.data?.id];
        if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !editorIdPattern.test(id))) return json(res, 400, { code: 1, msg: '画布编号无效' });
        if (ids.some(id => !this.editors.canWrite(id, req.headers['x-canvas-editor']))) return json(res, 409, { code: 1, msg: '画布正在另一个窗口编辑，保存或删除未执行' });
        this.editors.track(new Set(ids), res);
        const bytes = Buffer.from(JSON.stringify(payload));
        req.headers['content-length'] = String(bytes.length); delete req.headers['transfer-encoding'];
        return this.proxy.web(req, res, { target: `http://127.0.0.1:${this.apiPort}`, buffer: Readable.from([bytes]) });
      }
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
    const stream = require('node:fs').createReadStream(file);
    try { await once(stream, 'open'); }
    catch (error) { this.log('白模资源读取失败：' + error.code); return json(res, 500, { msg: '白模资源读取失败' }); }
    res.writeHead(200, { 'content-type': mime.lookup(file) || 'application/octet-stream', 'content-length': stat.size, 'cache-control': 'no-cache' });
    try { await pipeline(stream, res); }
    catch (error) { this.log('白模资源读取失败：' + error.code); if (!res.destroyed) res.destroy(); }
  }
  async provider(req, res, url) {
    const config = this.store.value;
    const director = url.pathname.startsWith('/local-ai/director/');
    const match = url.pathname.match(/^\/local-ai\/channels\/([a-zA-Z0-9_-]+)(?=\/)/);
    if (!director && !match) return json(res, 404, { error: { message: '模型渠道路径无效，请刷新工作台' } });
    const route = url.pathname.slice(director ? '/local-ai/director'.length : match[0].length).replace(/^\/v1(?=\/|$)/, '');
    let channel, bytes;
    if (director) {
      const channels = config.channels.filter(entry => entry.enabled);
      if (req.method === 'GET' && route === '/models') return json(res, 200, { object: 'list', data: channels.flatMap(entry => entry.models.filter(model => supportsRole(entry, model, 'director')).map(model => ({ id: directorModelId(entry.id, model), name: `${entry.name} · ${model}`, object: 'model', owned_by: entry.name }))) });
      if (req.method !== 'POST' || !['/chat/completions', '/responses'].includes(route)) return json(res, 404, { error: { message: '导演台模型接口无效' } });
      const body = await bodyJson(req, 64 * 1024 * 1024);
      channel = channels.find(entry => entry.models.some(model => supportsRole(entry, model, 'director') && directorModelId(entry.id, model) === body.model));
      if (!channel) return json(res, 400, { error: { message: '该渠道或模型已停用，请重新选择白模导演模型' } });
      body.model = body.model.slice(channel.id.length + 2);
      bytes = Buffer.from(JSON.stringify(body));
    } else channel = config.channels.find(entry => entry.id === match[1] && entry.enabled);
    if (!channel) return json(res, 400, { error: { message: '该渠道已停用或删除，请重新选择；已提交任务不会转到其他渠道' } });
    if (!channel.baseUrl) return json(res, 503, { error: { message: `请先配置渠道「${channel.name}」的接口地址` } });
    if (req.method === 'GET' && route === '/models') {
      return json(res, 200, { object: 'list', data: channel.models.map(id => ({ id, object: 'model', owned_by: channel.name })) });
    }
    if (channel.protocol === runningHub.protocol) {
      const videoSubmit = req.method === 'POST' && route === '/videos';
      const image = req.method === 'POST' && ['/runninghub/submit', '/runninghub/query'].includes(route);
      const resultDownload = req.method === 'POST' && route === '/runninghub/result';
      if (!jsonEqual(req.headers.authorization, `Bearer ${this.providerToken}`) || !(image || videoSubmit || resultDownload)) {
        return json(res, 403, { error: { message: '请选择工作台中该 RunningHub 渠道对应的生成模型' } });
      }
      const controller = new AbortController();
      res.once('close', () => controller.abort());
      try {
        if (resultDownload) {
          const { taskId } = await bodyJson(req, 4096);
          const response = await runningHub.downloadResult(channel, taskId, { fetchImpl: this.store.fetchImpl, signal: controller.signal });
          if (response.status !== 200) return json(res, 502, { error: { message: `RunningHub 结果下载失败（HTTP ${response.status}）` } });
          const headers = { 'content-type': response.headers.get('content-type') || 'application/octet-stream', 'cache-control': 'no-store' };
          if (!response.headers.has('content-encoding') && response.headers.has('content-length')) headers['content-length'] = response.headers.get('content-length');
          res.writeHead(200, headers);
          if (response.body) await pipeline(Readable.fromWeb(response.body), res); else res.end();
          return;
        }
        const input = await bodyJson(req, 96 * 1024 * 1024);
        const options = { fetchImpl: this.store.fetchImpl, signal: controller.signal };
        const result = image ? await runningHub.callStandardImage(channel, route, input, options) : await runningHub.callStandardVideo(channel, input, options);
        return json(res, 200, result);
      } catch (error) {
        if (!res.destroyed && !res.headersSent) return json(res, error.status || 502, { error: { message: error.message } });
        if (!res.destroyed) res.destroy();
        return;
      }
    }
    if (!/^\/(chat\/completions|responses|images\/(generations|edits)|videos(?:\/[^/?]+(?:\/content)?)?|audio\/(speech|transcriptions)|models)(?:\?|$)/.test(route)) return json(res, 404, { error: { message: '不支持的模型接口' } });
    return this.forwardModel(req, res, channel, route, url.search, bytes);
  }
  async forwardModel(req, res, channel, route, search, bytes) {
    const controller = new AbortController();
    res.once('close', () => { if (!res.writableFinished) controller.abort(); });
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD' && !bytes) bytes = await proxyBody(req);
      const headers = new Headers();
      const connectionHeaders = new Set(String(req.headers.connection || '').toLowerCase().split(',').map(value => value.trim()));
      for (const [name, value] of Object.entries(req.headers)) {
        if (value == null || reservedRequestHeaders.has(name) || connectionHeaders.has(name) || ['proxy-', 'sec-', 'access-control-request-'].some(prefix => name.startsWith(prefix))) continue;
        headers.set(name, Array.isArray(value) ? value.join(', ') : value);
      }
      if (channel.apiKey) headers.set('authorization', `Bearer ${channel.apiKey}`);
      const upstream = await this.store.fetchImpl(channel.baseUrl + '/v1' + route + search, { method: req.method, headers, ...(bytes ? { body: bytes } : {}), signal: controller.signal });
      const responseHeaders = {};
      const upstreamConnectionHeaders = new Set((upstream.headers.get('connection') || '').toLowerCase().split(',').map(value => value.trim()));
      for (const [name, value] of upstream.headers) {
        if (hopHeaders.has(name) || upstreamConnectionHeaders.has(name) || name.startsWith('proxy-') || ['set-cookie', 'content-encoding', 'content-length'].includes(name)) continue;
        responseHeaders[name] = value;
      }
      res.writeHead(upstream.status, responseHeaders);
      if (upstream.body) await pipeline(Readable.fromWeb(upstream.body), res); else res.end();
    } catch (error) {
      if (res.destroyed) return;
      if (error.message === '请求内容超过 200 MB') return json(res, 413, { code: 1, msg: error.message });
      const message = runningHub.networkError(`模型渠道「${channel.name}」连接失败，请核对接口地址、网络和系统代理`, error, channel.apiKey).message;
      this.log(message);
      if (!res.headersSent) json(res, 502, { code: 1, msg: message }); else res.destroy();
    }
  }
  async close({ force = false } = {}) { this.bridge.close(); await this.cancelPicker?.(); await this.model3D.close(); if (!force) await Promise.race([Promise.allSettled([...this.writes.values()]), require('node:timers/promises').setTimeout(2000, undefined, { ref: false })]); this.proxy.close(); for (const socket of this.sockets) socket.destroy(); this.server?.closeAllConnections(); await new Promise(resolve => this.server ? this.server.close(resolve) : resolve()); }
}

module.exports = { Gateway, bodyJson };
